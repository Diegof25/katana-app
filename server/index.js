const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session'); // Recordá: npm install express-session
const pool = require('./db'); // <--- CORRECCIÓN: Se agregó la conexión a la base de datos
require('dotenv').config();

const app = express();

// Configuración básica
app.use(cors());
app.use(express.json());

// 1. CONFIGURACIÓN DE SESIONES (Debe ir antes de las rutas)
app.use(session({
    secret: 'katana-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 3600000,
        // CORRECCIÓN: true si estás en internet (HTTPS), false si estás en tu PC
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'lax'
    }
}));

// 2. MIDDLEWARE DE SEGURIDAD (El "Portero")
const authRequired = (req, res, next) => {
    if (req.session.admin) {
        return next(); // Si tiene la sesión activa, pasa
    } else {
        return res.status(401).json({ error: "No autorizado. Por favor, iniciá sesión." });
    }
};

// 3. Ruta de Login mejorada con Base de Datos
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; 
    try {
        const result = await pool.query(
            'SELECT id, username, barbero_id FROM usuarios WHERE username = $1 AND password_hash = $2',
            [username, password]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            req.session.admin = true;
            req.session.barberoId = user.barbero_id; // Guardamos el ID del barbero en la sesión
            res.json({ success: true, barberoId: user.barbero_id });
        } else {
            res.status(401).json({ success: false, message: 'Usuario o clave incorrectos' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error en el servidor" });
    }
});

// ---------------------------------------------------------
// RUTA PARA GUARDAR CONFIGURACIÓN (Actualizada para Horario Cortado y Días)
// ---------------------------------------------------------
app.post('/api/admin/config', authRequired, async (req, res) => {
    // Recibimos los 4 horarios en lugar de 2
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
        res.json({ success: true, message: "Configuración guardada" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al guardar configuración" });
    }
});

// Ruta para obtener configuración (Pública para que cargue el Admin y el Index)
app.get('/api/config', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM configuracion WHERE id = 1');
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Error al obtener config" });
    }
});

// 4. RUTAS DE LA API
const turnosRoutes = require('./routes/turnos');

// Importante: Definimos primero la ruta protegida de administración
app.use('/api/admin', authRequired, turnosRoutes);

// Ruta pública para que los clientes puedan ver servicios y reservar
app.use('/api', turnosRoutes);

// ---------------------------------------------------------
// GESTIÓN DE BLOQUEOS (Guardar, Listar y Eliminar)
// ---------------------------------------------------------

// Ruta para guardar bloqueos
app.post('/api/admin/bloqueos', authRequired, async (req, res) => {
    const { fecha, tipo, inicio, fin } = req.body;
    const barberoId = req.session.barberoId; // <--- Obtenemos quién está bloqueando
    try {
        const hora_inicio = (tipo === 'parcial') ? inicio : null;
        const hora_fin = (tipo === 'parcial') ? fin : null;

        await pool.query(
            'INSERT INTO bloqueos (fecha, tipo, hora_inicio, hora_fin, barbero_id) VALUES ($1, $2, $3, $4, $5)',
            [fecha, tipo, hora_inicio, hora_fin, barberoId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Error al bloquear" });
    }
});

// Ruta para obtener la lista de bloqueos (Esto hará que aparezcan en el panel)
app.get('/api/admin/bloqueos', authRequired, async (req, res) => {
    try {
        const result = await pool.query(
        "SELECT id, TO_CHAR(fecha AT TIME ZONE 'UTC' AT TIME ZONE 'ART', 'YYYY-MM-DD') as fecha, tipo, hora_inicio as inicio, hora_fin as fin FROM bloqueos ORDER BY fecha ASC"        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al obtener bloqueos" });
    }
});

// Ruta para eliminar bloqueos (Arrepentirse)
app.delete('/api/admin/bloqueos/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM bloqueos WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al eliminar bloqueo" });
    }
});

// 5. SERVIR ARCHIVOS ESTÁTICOS (Al final de todo)
app.use(express.static(path.join(__dirname, '../public')));

// Fallback para SPA
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});


app.get('/api/check-session', (req, res) => {
    res.json({
        hasSession: !!req.session.admin,
        barberoId: req.session.barberoId || 'No hay ID',
        cookie: req.headers.cookie || 'No hay cookies enviadas'
    });
});

// 6. INICIO DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`-----------------------------------------`);
  console.log(`   KATANA BARBERSHOP - SERVIDOR ACTIVO   `);
  console.log(`   URL: http://localhost:${PORT}          `);
  console.log(`-----------------------------------------`);
});