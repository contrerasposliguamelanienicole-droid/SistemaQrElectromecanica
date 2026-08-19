const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const jwtConfig = require('../config/jwt');

// Registro de usuario
exports.register = async (req, res) => {
    try {
        const { nombre, email, password, telefono } = req.body;

        if (!nombre || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nombre, email y contraseña son requeridos' 
            });
        }

        const [existingUser] = await db.query(
            'SELECT id FROM usuarios WHERE email = ?', 
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'El email ya está registrado' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.query(
            'INSERT INTO usuarios (nombre, email, password_hash, telefono, rol) VALUES (?, ?, ?, ?, ?)',
            [nombre, email, hashedPassword, telefono || null, 'usuario']
        );

        res.status(201).json({ 
            success: true, 
            message: 'Usuario registrado exitosamente',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error en el servidor' 
        });
    }
};

// Login
// Login
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email y contraseña son requeridos'
            });
        }

        const [usuarios] = await db.query(
            'SELECT * FROM usuarios WHERE email = ?',
            [email]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        const usuario = usuarios[0];

        const isValidPassword = await bcrypt.compare(password, usuario.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // ⭐ USAR LA COLUMNA 'rol' DIRECTAMENTE
        const rol = usuario.rol || 'usuario';

        console.log('✅ Login exitoso'); // DEBUG
        console.log(`   - Usuario: ${usuario.nombre}`); // DEBUG
        console.log(`   - Email: ${usuario.email}`); // DEBUG
        console.log(`   - Rol: ${rol}`); // DEBUG

        const token = jwt.sign(
            { 
                id: usuario.id, 
                rol: rol
            },
            jwtConfig.secret,
            { expiresIn: jwtConfig.expiresIn }
        );

        res.json({
            success: true,
            message: 'Login exitoso',
            token,
            user: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                telefono: usuario.telefono,
                rol: rol,
                created_at: usuario.created_at
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Obtener usuario actual (perfil)
exports.getMe = async (req, res) => {
    try {
        const userId = req.userId;

        const [usuarios] = await db.query(
            'SELECT id, nombre, email, telefono, rol, created_at FROM usuarios WHERE id = ?',
            [userId]
        );

        if (usuarios.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        const usuario = usuarios[0];

        res.json({
            success: true,
            user: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                telefono: usuario.telefono,
                rol: usuario.rol || 'usuario',
                created_at: usuario.created_at
            }
        });

    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Actualizar perfil
exports.updateProfile = async (req, res) => {
    try {
        const { nombre, email, telefono } = req.body;
        const userId = req.userId;

        console.log('📝 Actualizando perfil del usuario:', userId);

        if (!nombre || !email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nombre y email son requeridos' 
            });
        }

        const [existingUser] = await db.query(
            'SELECT id FROM usuarios WHERE email = ? AND id != ?',
            [email, userId]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'El email ya está en uso' 
            });
        }

        await db.query(
            'UPDATE usuarios SET nombre = ?, email = ?, telefono = ? WHERE id = ?',
            [nombre, email, telefono || null, userId]
        );

        const [users] = await db.query(
            'SELECT id, nombre, email, rol, telefono, created_at FROM usuarios WHERE id = ?',
            [userId]
        );

        const user = users[0];

        const userData = {
            id: user.id,
            nombre: user.nombre,
            email: user.email,
            telefono: user.telefono,
            is_admin: user.rol === 'admin' ? 1 : 0,
            is_docente: user.rol === 'docente' ? 1 : 0,
            created_at: user.created_at
        };

        console.log('✅ Perfil actualizado:', userData);

        res.json({ 
            success: true,
            message: 'Perfil actualizado exitosamente',
            user: userData
        });

    } catch (error) {
        console.error('❌ Error actualizando perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error en el servidor' 
        });
    }
};

// Cambiar contraseña
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.userId;

        console.log('🔐 Cambio de contraseña para usuario:', userId);

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Contraseña actual y nueva son requeridas' 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'La nueva contraseña debe tener al menos 6 caracteres' 
            });
        }

        const [users] = await db.query(
            'SELECT password_hash FROM usuarios WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }

        const user = users[0];

        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);

        if (!validPassword) {
            console.log('❌ Contraseña actual incorrecta');
            return res.status(401).json({ 
                success: false, 
                message: 'La contraseña actual es incorrecta' 
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.query(
            'UPDATE usuarios SET password_hash = ? WHERE id = ?',
            [hashedPassword, userId]
        );

        console.log('✅ Contraseña actualizada exitosamente');

        res.json({ 
            success: true,
            message: 'Contraseña actualizada exitosamente'
        });

    } catch (error) {
        console.error('❌ Error cambiando contraseña:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error en el servidor' 
        });
    }
};

// NUEVOS MÉTODOS DE RECUPERACIÓN DE CONTRASEÑA
// Solicitar código de recuperación
exports.requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email es requerido'
            });
        }

        const [users] = await db.query(
            'SELECT * FROM usuarios WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No existe una cuenta con ese email'
            });
        }

        const user = users[0];
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 15);

        await db.query(
            'UPDATE usuarios SET reset_code = ?, reset_code_expires = ? WHERE id = ?',
            [resetCode, expiresAt, user.id]
        );

                // Responder de inmediato, sin esperar a que Gmail termine de enviar
        res.json({
            success: true,
            message: `Código enviado a ${user.email}. Revisa tu bandeja de entrada.`,
            email: user.email
        });

        // Enviar el correo en segundo plano (no bloquea la respuesta)
        const emailService = require('../services/emailService');
        emailService.sendPasswordResetCode(user.email, user.nombre, resetCode)
            .then(() => console.log(`Código enviado a: ${user.email}`))
            .catch(emailError => {
                console.error('Error enviando email:', emailError);
                console.log(`CÓDIGO DE DESARROLLO: ${resetCode}`);
            });
    } catch (error) {
        console.error('Error solicitando recuperación:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Verificar código y resetear contraseña
exports.resetPassword = async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;

        console.log('Intento de reset:', { email, code });

        if (!email || !code || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Email, código y nueva contraseña son requeridos'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe tener al menos 6 caracteres'
            });
        }

        const [users] = await db.query(
            'SELECT * FROM usuarios WHERE email = ? AND reset_code = ?',
            [email, code]
        );

        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Código inválido'
            });
        }

        const user = users[0];
        const now = new Date();
        const expiresAt = new Date(user.reset_code_expires);

        if (now > expiresAt) {
            return res.status(400).json({
                success: false,
                message: 'El código ha expirado. Solicita uno nuevo.'
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.query(
            'UPDATE usuarios SET password_hash = ?, reset_code = NULL, reset_code_expires = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );

        console.log(`Contraseña reseteada: ${user.email}`);

        res.json({
            success: true,
            message: 'Contraseña actualizada exitosamente'
        });
    } catch (error) {
        console.error('Error reseteando contraseña:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};