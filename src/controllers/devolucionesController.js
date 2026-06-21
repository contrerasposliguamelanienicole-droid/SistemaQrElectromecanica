const db = require('../config/database');

// Crear solicitud de devolución (usuario)
exports.crearDevolucion = async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { prestamo_id, herramienta_id, estado_herramienta, observaciones_usuario } = req.body;
        const usuario_id = req.userId;

        // Validar campos requeridos
        if (!prestamo_id || !herramienta_id || !estado_herramienta) {
            return res.status(400).json({
                success: false,
                message: 'Préstamo, herramienta y estado son requeridos'
            });
        }

        await connection.beginTransaction();

        // Verificar que el préstamo existe y pertenece al usuario
        const [prestamos] = await connection.query(
            `SELECT p.*, h.codigo_qr, h.descripcion as herramienta_nombre
             FROM prestamos p
             INNER JOIN herramientas h ON p.herramienta_id = h.id
             WHERE p.id = ? AND p.usuario_id = ? AND p.estado = 'activo'`,
            [prestamo_id, usuario_id]
        );

        if (prestamos.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Préstamo no encontrado o ya fue devuelto'
            });
        }

        const prestamo = prestamos[0];

        // Verificar que el código QR coincide
        const [herramientas] = await connection.query(
            'SELECT id, codigo_qr FROM herramientas WHERE id = ?',
            [herramienta_id]
        );

        if (herramientas.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Herramienta no encontrada'
            });
        }

        if (herramientas[0].codigo_qr !== prestamo.codigo_qr) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'El código QR no coincide con la herramienta del préstamo'
            });
        }

        // Verificar que no tenga una devolución pendiente
        const [devolucionesPendientes] = await connection.query(
            `SELECT id FROM devoluciones 
             WHERE prestamo_id = ? AND estado = 'pendiente'`,
            [prestamo_id]
        );

        if (devolucionesPendientes.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Ya tienes una solicitud de devolución pendiente para este préstamo'
            });
        }

        // Crear la solicitud de devolución
        const [result] = await connection.query(
            `INSERT INTO devoluciones 
            (prestamo_id, usuario_id, herramienta_id, fecha_devolucion, estado_herramienta, observaciones_usuario) 
            VALUES (?, ?, ?, NOW(), ?, ?)`,
            [prestamo_id, usuario_id, herramienta_id, estado_herramienta, observaciones_usuario || null]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Solicitud de devolución enviada. Espera la revisión del administrador',
            devolucionId: result.insertId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error creando devolución:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    } finally {
        connection.release();
    }
};

// Obtener mis devoluciones (usuario)
exports.misDevoluciones = async (req, res) => {
    try {
        const [devoluciones] = await db.query(`
            SELECT d.*, 
                   h.descripcion as herramienta_nombre, h.codigo_qr, h.imagen_url,
                   p.fecha_prestamo, p.fecha_devolucion_estimada,
                   ar.nombre as admin_revisor_nombre
            FROM devoluciones d
            INNER JOIN herramientas h ON d.herramienta_id = h.id
            INNER JOIN prestamos p ON d.prestamo_id = p.id
            LEFT JOIN usuarios ar ON d.admin_revisor_id = ar.id
            WHERE d.usuario_id = ?
            ORDER BY d.created_at DESC
        `, [req.userId]);

        res.json({
            success: true,
            devoluciones
        });

    } catch (error) {
        console.error('Error obtener mis devoluciones:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Listar todas las devoluciones pendientes (admin)
exports.listarDevoluciones = async (req, res) => {
    try {
        const { estado } = req.query;

        let query = `
            SELECT d.*, 
                   u.nombre as usuario_nombre, u.email as usuario_email,
                   h.descripcion as herramienta_nombre, h.codigo_qr, h.estado as estado_actual_herramienta,
                   p.fecha_prestamo, p.fecha_devolucion_estimada,
                   ar.nombre as admin_revisor_nombre
            FROM devoluciones d
            INNER JOIN usuarios u ON d.usuario_id = u.id
            INNER JOIN herramientas h ON d.herramienta_id = h.id
            INNER JOIN prestamos p ON d.prestamo_id = p.id
            LEFT JOIN usuarios ar ON d.admin_revisor_id = ar.id
        `;

        const params = [];

        if (estado) {
            query += ' WHERE d.estado = ?';
            params.push(estado);
        }

        query += ' ORDER BY d.created_at DESC';

        const [devoluciones] = await db.query(query, params);

        res.json({
            success: true,
            devoluciones
        });

    } catch (error) {
        console.error('Error listando devoluciones:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Aprobar devolución (admin)
exports.aprobarDevolucion = async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { id } = req.params;
        const { nuevo_estado_herramienta, observaciones_admin } = req.body;
        const admin_id = req.userId;

        // Validar nuevo estado
        if (!nuevo_estado_herramienta || !['disponible', 'mantenimiento', 'baja'].includes(nuevo_estado_herramienta)) {
            return res.status(400).json({
                success: false,
                message: 'Debes indicar el nuevo estado de la herramienta (disponible, mantenimiento, baja)'
            });
        }

        await connection.beginTransaction();

        // Verificar que la devolución existe y está pendiente
        const [devoluciones] = await connection.query(
            'SELECT * FROM devoluciones WHERE id = ?',
            [id]
        );

        if (devoluciones.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Devolución no encontrada'
            });
        }

        const devolucion = devoluciones[0];

        if (devolucion.estado !== 'pendiente') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `La devolución ya fue ${devolucion.estado}`
            });
        }

        // OBTENER LA CANTIDAD REAL PRESTADA DESDE EL PRÉSTAMO ORIGINAL
        const [prestamosInfo] = await connection.query(
            'SELECT cantidad_prestada FROM prestamos WHERE id = ?',
            [devolucion.prestamo_id]
        );

        if (prestamosInfo.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'El préstamo asociado a esta devolución ya no existe'
            });
        }

        const cantidadPrestada = parseInt(prestamosInfo[0].cantidad_prestada, 10) || 1;

        // OBTENER LA HERRAMIENTA EN TIEMPO REAL PARA ACTUALIZAR SU STOCK
        const [herramientas] = await connection.query(
            'SELECT cantidad_disponible FROM herramientas WHERE id = ? FOR UPDATE',
            [devolucion.herramienta_id]
        );

        if (herramientas.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'La herramienta asociada ya no existe en el sistema'
            });
        }

        const herramienta = herramientas[0];
        const cantidadActual = parseInt(herramienta.cantidad_disponible, 10) || 0;

        // El stock solo aumenta si la herramienta vuelve a estar apta ('disponible')
        // Se suma la cantidad EXACTA que se había prestado, no un valor fijo
        let nuevaCantidadDisponible = cantidadActual;
        if (nuevo_estado_herramienta === 'disponible') {
            nuevaCantidadDisponible = cantidadActual + cantidadPrestada;
        }

        // Actualizar la devolución
        await connection.query(
            `UPDATE devoluciones 
             SET estado = 'aprobada', 
                 admin_revisor_id = ?, 
                 nuevo_estado_herramienta = ?, 
                 observaciones_admin = ?,
                 fecha_revision = NOW()
             WHERE id = ?`,
            [admin_id, nuevo_estado_herramienta, observaciones_admin || null, id]
        );

        // Actualizar el préstamo a 'devuelto'
        await connection.query(
            `UPDATE prestamos 
             SET estado = 'devuelto', fecha_devolucion_real = NOW()
             WHERE id = ?`,
            [devolucion.prestamo_id]
        );

        // Actualizar el estado Y la cantidad disponible de la herramienta
        await connection.query(
            'UPDATE herramientas SET cantidad_disponible = ?, estado = ? WHERE id = ?',
            [nuevaCantidadDisponible, nuevo_estado_herramienta, devolucion.herramienta_id]
        );

        // Registrar en historial
        await connection.query(
            `INSERT INTO historial (usuario_id, accion, entidad_tipo, entidad_id, detalles)
             VALUES (?, 'aprobar_devolucion', 'devolucion', ?, ?)`,
            [admin_id, id, `Devolución aprobada. Estado herramienta: ${nuevo_estado_herramienta}. Stock actual: ${nuevaCantidadDisponible}`]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Devolución aprobada y herramienta actualizada exitosamente'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error aprobando devolución:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    } finally {
        connection.release();
    }
};

// Rechazar devolución (admin)
exports.rechazarDevolucion = async (req, res) => {
    try {
        const { id } = req.params;
        const { observaciones_admin } = req.body;
        const admin_id = req.userId;

        if (!observaciones_admin) {
            return res.status(400).json({
                success: false,
                message: 'Debes indicar el motivo del rechazo'
            });
        }

        // Verificar que la devolución existe y está pendiente
        const [devoluciones] = await db.query(
            'SELECT estado FROM devoluciones WHERE id = ?',
            [id]
        );

        if (devoluciones.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Devolución no encontrada'
            });
        }

        if (devoluciones[0].estado !== 'pendiente') {
            return res.status(400).json({
                success: false,
                message: `La devolución ya fue ${devoluciones[0].estado}`
            });
        }

        // Actualizar devolución a rechazada
        await db.query(
            `UPDATE devoluciones 
             SET estado = 'rechazada', 
                 admin_revisor_id = ?, 
                 observaciones_admin = ?,
                 fecha_revision = NOW()
             WHERE id = ?`,
            [admin_id, observaciones_admin, id]
        );

        // Registrar en historial
        await db.query(
            `INSERT INTO historial (usuario_id, accion, entidad_tipo, entidad_id, detalles)
             VALUES (?, 'rechazar_devolucion', 'devolucion', ?, ?)`,
            [admin_id, id, observaciones_admin]
        );

        res.json({
            success: true,
            message: 'Devolución rechazada'
        });

    } catch (error) {
        console.error('Error rechazando devolución:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Obtener préstamo activo por QR (para validar al devolver)
exports.obtenerPrestamoPorQR = async (req, res) => {
    try {
        const { codigo_qr } = req.params;
        const usuario_id = req.userId;

        const [prestamos] = await db.query(`
            SELECT p.*, h.descripcion as herramienta_nombre, h.imagen_url, h.codigo_qr
            FROM prestamos p
            INNER JOIN herramientas h ON p.herramienta_id = h.id
            WHERE h.codigo_qr = ? AND p.usuario_id = ? AND p.estado = 'activo'
            ORDER BY p.created_at DESC
            LIMIT 1
        `, [codigo_qr, usuario_id]);

        if (prestamos.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No tienes un préstamo activo de esta herramienta'
            });
        }

        res.json({
            success: true,
            prestamo: prestamos[0]
        });

    } catch (error) {
        console.error('Error obteniendo préstamo por QR:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

module.exports = exports;