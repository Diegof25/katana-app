const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session'); // Recordá: npm install express-session
const pool = require('./db'); // <--- CORRECCIÓN: Se agregó la conexión a la base de datos
require('dotenv').config();

const app = express();

// Configuración básica
app.use(express.json());

// 1. Configuración de CORS para permitir credenciales (Cookies)
app.use(cors({
    origin: true, // Permite que el origen del frontend conecte
    credentials: true // Crucial: permite que las cookies viajen
}));

app.use(express.json());

// 2. Ajuste en la configuración de SESIONES
app.use(session({
    secret: process.env.SESSION_SECRET || 'secreto-muy-seguro',
    resave: false, 
    saveUninitialized: false, 
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24,
        secure: false, // Ponelo en false mientras estés en desarrollo (localhost)
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
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; 
    try {
        const result = await pool.query(
            'SELECT id, username, barbero_id FROM usuarios WHERE username = $1 AND password_hash = $2',
            [username, password]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            
            // Seteamos los datos
            req.session.admin = true;
            req.session.barberoId = user.barbero_id;

            // --- CRUCIAL: Forzamos el guardado manual ---
            req.session.save((err) => {
                if (err) {
                    console.error("Error al guardar sesión:", err);
                    return res.status(500).json({ error: "Error al iniciar sesión" });
                }
                // Recién cuando estamos SEGUROS de que se guardó, respondemos
                res.json({ success: true, barberoId: user.barbero_id });
            });
            
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
    const { m_apertura, m_cierre, t_apertura, t_cierre, intervalo, dias_laborales } = req.body;
    const barberoId = req.session.barberoId;

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
        console.error("Error al guardar configuración:", err);
        res.status(500).json({ error: "Error en la base de datos" });
    }
});
// Ruta para obtener configuración (Pública para que cargue el Admin y el Index)
app.get('/api/config', async (req, res) => {
    const { barbero_id } = req.query; // <--- Importante: lo saca de la URL (?barbero_id=X)
    try {
        const result = await pool.query(
            'SELECT * FROM configuracion WHERE barbero_id = $1', 
            [barbero_id]
        );
        res.json(result.rows[0] || {}); // Si no hay nada, manda un objeto vacío
    } catch (err) {
        res.status(500).json({ error: "Error al obtener config" });
    }
});

// --- 4. RUTAS DE LA API ---
const turnosRoutes = require('./routes/turnos');

/**
 * IMPORTANTE: 
 * Al usar app.use('/api', turnosRoutes), las rutas dentro de turnos.js 
 * que ya dicen '/admin/...' quedarán como '/api/admin/...'.
 * * La protección 'authRequired' la aplicamos directamente aquí 
 * mediante una lógica de validación o dentro del mismo turnos.js.
 */

// Aplicamos el middleware de seguridad solo a las rutas que contienen "admin"
app.use('/api', (req, res, next) => {
    if (req.path.includes('/admin')) {
        return authRequired(req, res, next);
    }
    next();
}, turnosRoutes);

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

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: "No se pudo cerrar sesión" });
        res.clearCookie('connect.sid'); // Limpia la cookie del navegador
        res.json({ success: true });
    });
});

// 5. SERVIR ARCHIVOS ESTÁTICOS (Al final de todo)
app.use(express.static(path.join(__dirname, '../public')));

// Fallback para SPA
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 6. INICIO DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`-----------------------------------------`);
  console.log(`   KATANA BARBERSHOP - SERVIDOR ACTIVO   `);
  console.log(`   URL: http://localhost:${PORT}          `);
  console.log(`-----------------------------------------`);
});