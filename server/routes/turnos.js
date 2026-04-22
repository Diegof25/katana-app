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
        // 1. PRIMERO: Verificar si hay un bloqueo total (franco/feriado)
        const bloqueoTotal = await pool.query(
            "SELECT id FROM bloqueos WHERE fecha = $1 AND tipo = 'todo'", 
            [fecha]
        );

        if (bloqueoTotal.rows.length > 0) {
            return res.json({ 
                horarios: [], 
                mensaje: "Día no disponible (Franco/Bloqueado)" 
            });
        }

        // 2. Traer la configuración de horarios
        const configResult = await pool.query('SELECT * FROM configuracion LIMIT 1');
        const config = configResult.rows[0];

        // --- CORRECCIÓN DEL ERROR DE DÍA LABORAL ---
        const [year, month, day] = fecha.split('-').map(Number);
        const diaSemana = new Date(year, month - 1, day).getDay(); 
        const diasLaborales = config.dias_laborales.split(',').map(d => d.trim());

        if (!diasLaborales.includes(diaSemana.toString())) {
            return res.json({ horarios: [], mensaje: "Cerrado este día" });
        }
        // --------------------------------------------

        // 4. Traer turnos ya tomados (FILTRADO POR BARBERO) y bloqueos parciales
        const turnosOcupados = await pool.query(
            `SELECT TO_CHAR(fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI') as hora 
            FROM turnos 
            WHERE DATE(fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires') = $1
            AND barbero_id = $2`,
            [fecha, barbero_id]
        );

        const bloqueosParciales = await pool.query(
            `SELECT TO_CHAR(hora_inicio, 'HH24:MI') as inicio, TO_CHAR(hora_fin, 'HH24:MI') as fin 
            FROM bloqueos 
            WHERE fecha = $1 AND tipo = 'parcial' 
            AND (barbero_id = $2 OR barbero_id IS NULL)`,
            [fecha, barbero_id]
        );
        
        const horasOcupadas = turnosOcupados.rows.map(t => t.hora);
        let horariosPosibles = [];

        // Función auxiliar para generar slots (Mañana y Tarde)
        const generarSlots = (inicioStr, finStr) => {
            if (!inicioStr || !finStr) return;

            let actual = new Date(`2026-01-01 ${inicioStr}`);
            let limite = new Date(`2026-01-01 ${finStr}`);

            const ahora = new Date();
            
            const fechaHoyStr = ahora.toLocaleDateString('en-CA', { 
                timeZone: 'America/Argentina/Buenos_Aires' 
            });

            const tiempoCorte = new Date(ahora.toLocaleString('en-US', { 
                timeZone: 'America/Argentina/Buenos_Aires' 
            }));
            tiempoCorte.setMinutes(tiempoCorte.getMinutes() + 30);
            
            const horaCorteStr = tiempoCorte.toLocaleTimeString('es-AR', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            while (actual < limite) {
                let horaTexto = actual.toTimeString().slice(0, 5);
                
                const estaEnBloqueoParcial = bloqueosParciales.rows.some(b => 
                    horaTexto >= b.inicio && horaTexto < b.fin
                );
                
                let yaPaso = (fecha === fechaHoyStr && horaTexto <= horaCorteStr);

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
        res.status(500).json({ error: "Error al consultar disponibilidad" });
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
    try {
        await pool.query(
            `INSERT INTO configuracion (id, mañana_apertura, mañana_cierre, tarde_apertura, tarde_cierre, intervalo, dias_laborales) 
             VALUES (1, $1, $2, $3, $4, $5, $6) 
             ON CONFLICT (id) DO UPDATE SET 
                mañana_apertura = $1, mañana_cierre = $2, 
                tarde_apertura = $3, tarde_cierre = $4, 
                intervalo = $5, dias_laborales = $6`,
            [m_apertura, m_cierre, t_apertura, t_cierre, intervalo, dias_laborales]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
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