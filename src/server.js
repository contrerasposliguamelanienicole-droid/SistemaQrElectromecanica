const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const herramientasRoutes = require('./routes/herramientas');
const prestamosRoutes = require('./routes/prestamos');
const solicitudesRoutes = require('./routes/solicitudes');
const usuariosRoutes = require('./routes/usuarios');
const devolucionesRoutes = require('./routes/devoluciones');
const categoriasRoutes = require('./routes/categorias');
const estadisticasRoutes = require('./routes/estadisticas');


const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/herramientas', herramientasRoutes);
app.use('/api/prestamos', prestamosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/devoluciones', devolucionesRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/estadisticas', estadisticasRoutes);


// Ruta de prueba
app.get('/', (req, res) => {
    res.json({ 
        success: true, 
        message: 'API Sistema de Préstamos - Funcionando ✅',
        version: '2.0',
        endpoints: {
            auth: '/api/auth',
            herramientas: '/api/herramientas',
            prestamos: '/api/prestamos',
            solicitudes: '/api/solicitudes',
            usuarios: '/api/usuarios (solo admin)'
        }
    });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});