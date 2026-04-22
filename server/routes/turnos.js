const express = require('express');
const router = express.Router();
const pool = require('../db');

// --- CLIENTE: SERVICIOS ---
router.get('/servicios', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM servicios');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Error al traer servicios" });
    }
});

router.get('/barberos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM barberos');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Error al traer barberos" });
    }
});


// --- CLIENTE: CALCULAR DISPONIBILIDAD ---
router.get('/horarios-disponibles', async (req, res) => {
    const { fecha, barbero_id } = req.query; 
    
    try {
        // 1. Verificar si hay un bloqueo total para ESTE barbero o general
        const bloqueoTotal = await pool.query(
            "SELECT id FROM bloqueos WHERE fecha = $1 AND tipo = 'todo' AND (barbero_id = $2 OR barbero_id IS NULL)", 
            [fecha, barbero_id]
        );

        if (bloqueoTotal.rows.length > 0) {
            return res.json({ 
                horarios: [], 
                mensaje: "Día no disponible para este barbero" 
            });
        }

        // 2. Traer la configuración ESPECÍFICA de este barbero
        // IMPORTANTE: Tu tabla configuracion debe tener la columna barbero_id
        const configResult = await pool.query(
            'SELECT * FROM configuracion WHERE barbero_id = $1', 
            [barbero_id]
        );
        
        const config = configResult.rows[0];

        // Si el barbero no configuró nada, podrías usar una por defecto o dar error
        if (!config) {
            return res.json({ horarios: [], mensaje: "Barbero sin horarios configurados" });
        }

        // 3. Verificar día laboral
        const [year, month, day] = fecha.split('-').map(Number);
        const diaSemana = new Date(year, month - 1, day).getDay(); 
        const diasLaborales = config.dias_laborales.split(',').map(d => d.trim());

        if (!diasLaborales.includes(diaSemana.toString())) {
            return res.json({ horarios: [], mensaje: "Cerrado este día" });
        }

        // 4. Traer turnos tomados SOLO para este barbero
        const turnosOcupados = await pool.query(
            `SELECT TO_CHAR(fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI') as hora 
            FROM turnos 
            WHERE DATE(fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires') = $1
            AND barbero_id = $2`, 
            [fecha, barbero_id]
        );

        // 5. Traer bloqueos parciales SOLO para este barbero o generales
        const bloqueosParciales = await pool.query(
            `SELECT TO_CHAR(hora_inicio, 'HH24:MI') as inicio, TO_CHAR(hora_fin, 'HH24:MI') as fin 
            FROM bloqueos 
            WHERE fecha = $1 AND tipo = 'parcial' 
            AND (barbero_id = $2 OR barbero_id IS NULL)`,
            [fecha, barbero_id]
        );
        
        const horasOcupadas = turnosOcupados.rows.map(t => t.hora);
        let horariosPosibles = [];

        const generarSlots = (inicioStr, finStr) => {
            if (!inicioStr || !finStr) return;

            let actual = new Date(`2026-01-01 ${inicioStr}`);
            let limite = new Date(`2026-01-01 ${finStr}`);
            const ahora = new Date();
            const fechaHoyStr = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
            const tiempoCorte = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
            tiempoCorte.setMinutes(tiempoCorte.getMinutes() + 30);
            const horaCorteStr = tiempoCorte.toLocaleTimeString('es-AR', { hour12: false, hour: '2-digit', minute: '2-digit' });

            while (actual < limite) {
                let horaTexto = actual.toTimeString().slice(0, 5);
                const estaEnBloqueoParcial = bloqueosParciales.rows.some(b => horaTexto >= b.inicio && horaTexto < b.fin);
                let yaPaso = (fecha === fechaHoyStr && horaTexto <= horaCorteStr);

                // Aquí está la magia: filtramos contra las horas ocupadas DE ESTE BARBERO
                if (!horasOcupadas.includes(horaTexto) && !estaEnBloqueoParcial && !yaPaso) {
                    horariosPosibles.push(horaTexto);
                }
                actual.setMinutes(actual.getMinutes() + parseInt(config.intervalo));
            }
        };

        generarSlots(config.mañana_apertura, config.mañana_cierre);
        generarSlots(config.tarde_apertura, config.tarde_cierre);

        res.json({ horarios: horariosPosibles });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error de servidor" });
    }
});
// --- CLIENTE: RESERVAR ---
router.post('/reservar', async (req, res) => {
    const { nombre, telefono, servicio_id, fecha, barbero_id } = req.body; // <--- Recibimos barbero_id
    try {
        await pool.query(
            `INSERT INTO turnos (cliente_nombre, cliente_telefono, servicio_id, barbero_id, fecha_hora) 
             VALUES ($1, $2, $3, $4, $5::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')`,
            [nombre, telefono, servicio_id, barbero_id, fecha]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "Error al reservar" });
    }
});

// --- ADMIN: ACTUALIZAR CONFIGURACIÓN (CON DOBLE TURNO) ---
router.post('/admin/config', async (req, res) => {
    const { m_apertura, m_cierre, t_apertura, t_cierre, intervalo, dias_laborales } = req.body;
    
    // IMPORTANTE: Sacamos el ID del barbero de la sesión
    const barberoId = req.session.barberoId;

    if (!barberoId) {
        return res.status(401).json({ error: "Sesión no válida" });
    }

    try {
        await pool.query(
            `INSERT INTO configuracion (barbero_id, mañana_apertura, mañana_cierre, tarde_apertura, tarde_cierre, intervalo, dias_laborales) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             ON CONFLICT (barbero_id) DO UPDATE SET 
                mañana_apertura = EXCLUDED.mañana_apertura, 
                mañana_cierre = EXCLUDED.mañana_cierre, 
                tarde_apertura = EXCLUDED.tarde_apertura, 
                tarde_cierre = EXCLUDED.tarde_cierre, 
                intervalo = EXCLUDED.intervalo, 
                dias_laborales = EXCLUDED.dias_laborales`,
            [barberoId, m_apertura, m_cierre, t_apertura, t_cierre, intervalo, dias_laborales]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Error al guardar config en turnos.js:", err);
        res.status(500).json({ error: "Error al guardar configuración" });
    }
});

// --- ADMIN: VER AGENDA ---
router.get('/admin/turnos', async (req, res) => {
    try {
        let query = `
            SELECT turnos.id, turnos.cliente_nombre, turnos.cliente_telefono,
                   servicios.nombre as servicio_nombre, barberos.nombre as barbero_nombre,
                   TO_CHAR(turnos.fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') as fecha_hora
            FROM turnos 
            JOIN servicios ON turnos.servicio_id = servicios.id 
            JOIN barberos ON turnos.barbero_id = barberos.id `;

        const params = [];

        // SI EL USUARIO ES BARBERO: Filtramos solo sus turnos
        if (req.session.barberoId) {
            query += ` WHERE turnos.barbero_id = $1 `;
            params.push(req.session.barberoId);
        }

        query += ` ORDER BY turnos.fecha_hora ASC `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Error en la agenda" });
    }
});

router.delete('/admin/turnos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM turnos WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Error al eliminar" });
    }
});

module.exports = router;