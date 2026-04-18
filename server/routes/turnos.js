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

// --- CLIENTE: CALCULAR DISPONIBILIDAD ---
router.get('/horarios-disponibles', async (req, res) => {
    const { fecha } = req.query; // Formato YYYY-MM-DD
    
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

        // 3. Verificar si es día laboral (según los checkboxes del admin)
        const diaSemana = new Date(fecha).getUTCDay(); 
        if (!config.dias_laborales.split(',').includes(diaSemana.toString())) {
            return res.json({ horarios: [], mensaje: "Cerrado este día" });
        }

        // 4. Traer turnos ya tomados y bloqueos parciales
        const turnosOcupados = await pool.query(
            "SELECT TO_CHAR(fecha_hora, 'HH24:MI') as hora FROM turnos WHERE DATE(fecha_hora) = $1", 
            [fecha]
        );
        const bloqueosParciales = await pool.query(
            "SELECT TO_CHAR(hora_inicio, 'HH24:MI') as inicio, TO_CHAR(hora_fin, 'HH24:MI') as fin FROM bloqueos WHERE fecha = $1 AND tipo = 'parcial'", 
            [fecha]
        );
        
        const horasOcupadas = turnosOcupados.rows.map(t => t.hora);
        let horariosPosibles = [];

        // Función auxiliar para generar slots (Mañana y Tarde)
const generarSlots = (inicioStr, finStr) => {
    if (!inicioStr || !finStr) return;

    // 1. Configuramos el inicio y el límite de la franja horaria
    let actual = new Date(`2026-01-01 ${inicioStr}`);
    let limite = new Date(`2026-01-01 ${finStr}`);

    // 2. Lógica de Tiempo Real para Argentina
    const ahora = new Date();
    
    // Obtenemos la fecha de hoy en formato YYYY-MM-DD (Ej: 2026-04-18)
    const fechaHoyStr = ahora.toLocaleDateString('en-CA', { 
        timeZone: 'America/Argentina/Buenos_Aires' 
    });

    // Calculamos el "Tiempo de Corte": Hora actual + 30 minutos
    const tiempoCorte = new Date(ahora.toLocaleString('en-US', { 
        timeZone: 'America/Argentina/Buenos_Aires' 
    }));
    tiempoCorte.setMinutes(tiempoCorte.getMinutes() + 30);
    
    // Formateamos la hora de corte a HH:mm
    const horaCorteStr = tiempoCorte.toLocaleTimeString('es-AR', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    while (actual < limite) {
        let horaTexto = actual.toTimeString().slice(0, 5);
        
        // A. Verificar bloqueos parciales (siesta/trámites)
        const estaEnBloqueoParcial = bloqueosParciales.rows.some(b => 
            horaTexto >= b.inicio && horaTexto < b.fin
        );
        
        // B. Validación de "Hoy" y "Margen de 30 min"
        // Si la fecha elegida es HOY, filtramos lo que esté antes de la hora de corte
        let yaPaso = (fecha === fechaHoyStr && horaTexto <= horaCorteStr);

        // C. Filtro final: que no esté ocupado, ni bloqueado, ni que ya haya pasado
        if (!horasOcupadas.includes(horaTexto) && !estaEnBloqueoParcial && !yaPaso) {
            horariosPosibles.push(horaTexto);
        }

        // Sumar el intervalo (30, 45 o 60 min)
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
    const { nombre, telefono, servicio_id, fecha } = req.body;
    try {
        await pool.query(
            'INSERT INTO turnos (cliente_nombre, cliente_telefono, servicio_id, fecha_hora) VALUES ($1, $2, $3, $4)',
            [nombre, telefono, servicio_id, fecha]
        );
        res.json({ success: true, message: "¡Turno reservado!" });
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
        const result = await pool.query(`
            SELECT turnos.*, servicios.nombre as servicio_nombre 
            FROM turnos 
            JOIN servicios ON turnos.servicio_id = servicios.id 
            ORDER BY fecha_hora ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Error en la base de datos" });
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