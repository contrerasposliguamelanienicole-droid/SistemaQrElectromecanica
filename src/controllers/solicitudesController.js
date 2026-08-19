const db = require('../config/database');

// Crear solicitud de préstamo (usuarios)
exports.crearSolicitud = async (req, res) => {
    try {
        const { herramienta_id, fecha_uso_estimada, fecha_devolucion_estimada, motivo, cantidad } = req.body;
        const usuario_id = req.userId;

        // Validar campos
        if (!herramienta_id || !fecha_uso_estimada || !fecha_devolucion_estimada) {
            return res.status(400).json({
                success: false,
                message: 'Herramienta, fecha de uso y fecha de devolución son requeridas'
            });
        }

        // Verificar que la herramienta existe y tiene stock disponible
        const [herramientas] = await db.query(
            'SELECT id, nombre, estado, cantidad_disponible FROM herramientas WHERE id = ?',
            [herramienta_id]
        );

        if (herramientas.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Herramienta no encontrada'
            });
        }

        const herramienta = herramientas[0];
        const cantidadA_Pedir = parseInt(cantidad, 10) || 1;

        // Validar si hay unidades disponibles suficientes en inventario
        if (herramienta.cantidad_disponible < cantidadA_Pedir || herramienta.estado === 'mantenimiento') {
            return res.status(400).json({
                success: false,
                message: 'La herramienta no cuenta con el stock solicitado o está en mantenimiento'
            });
        }

        // Verificar que el usuario no tenga solicitudes pendientes de la misma herramienta
        const [solicitudesPendientes] = await db.query(
            `SELECT id FROM solicitudes 
             WHERE usuario_id = ? AND herramienta_id = ? AND estado = 'pendiente'`,
            [usuario_id, herramienta_id]
        );

        if (solicitudesPendientes.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya tienes una solicitud pendiente para esta herramienta'
            });
        }

        // Crear solicitud guardando la cantidad exacta elegida
        const [result] = await db.query(
            `INSERT INTO solicitudes 
            (usuario_id, herramienta_id, fecha_uso_estimada, fecha_devolucion_estimada, motivo, cantidad) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [usuario_id, herramienta_id, fecha_uso_estimada, fecha_devolucion_estimada, motivo || null, cantidadA_Pedir]
        );

        res.status(201).json({
            success: true,
            message: 'Solicitud enviada. Espera la aprobación del administrador',
            solicitudId: result.insertId
        });

    } catch (error) {
        console.error('Error creando solicitud:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Listar solicitudes del usuario actual
exports.misSolicitudes = async (req, res) => {
    try {
        const [solicitudes] = await db.query(`
            SELECT s.*, 
                   h.descripcion as herramienta_nombre, 
                   h.codigo_qr, 
                   h.imagen_url,
                   c.nombre as categoria_nombre,
                   ar.nombre as admin_revisor_nombre
            FROM solicitudes s
            INNER JOIN herramientas h ON s.herramienta_id = h.id
            LEFT JOIN categorias c ON h.categoria_id = c.id
            LEFT JOIN usuarios ar ON s.admin_revisor_id = ar.id
            WHERE s.usuario_id = ?
            ORDER BY s.created_at DESC
        `, [req.userId]);

        res.json({
            success: true,
            solicitudes
        });

    } catch (error) {
        console.error('Error obteniendo mis solicitudes:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Listar todas las solicitudes (admin)
exports.listarSolicitudes = async (req, res) => {
    try {
        const { estado } = req.query;

        let query = `
            SELECT s.*, 
                   u.nombre as usuario_nombre, u.email as usuario_email, u.telefono as usuario_telefono,
                   h.nombre as herramienta_nombre, h.codigo_qr, h.estado as herramienta_estado,
                   h.cantidad_disponible, h.cantidad_total,
                   ar.nombre as admin_revisor_nombre
            FROM solicitudes s
            INNER JOIN usuarios u ON s.usuario_id = u.id
            INNER JOIN herramientas h ON s.herramienta_id = h.id
            LEFT JOIN usuarios ar ON s.admin_revisor_id = ar.id
        `;

        const params = [];
        if (estado) {
            query += ' WHERE s.estado = ?';
            params.push(estado);
        }

        query += ' ORDER BY s.created_at DESC';

        const [solicitudes] = await db.query(query, params);

        res.json({
            success: true,
            solicitudes
        });

    } catch (error) {
        console.error('Error listando solicitudes:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Aprobar solicitud (admin) - CANTIDADES CORREGIDAS Y SIN ERRORES DE SINTAXIS
exports.aprobarSolicitud = async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { id } = req.params;
        const { comentario_admin } = req.body;
        const admin_id = req.userId;

        await connection.beginTransaction();

        // 1. Verificar que la solicitud existe
        const [solicitudes] = await connection.query(
            'SELECT * FROM solicitudes WHERE id = ?',
            [id]
        );

        if (solicitudes.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Solicitud no encontrada'
            });
        }

        const solicitud = solicitudes[0];
        // Restamos el número exacto solicitado (si no está definido aún en la BD, toma 1)
        const cantidadSolicitada = parseInt(solicitud.cantidad, 10) || 1;

        if (solicitud.estado !== 'pendiente') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `La solicitud ya fue ${solicitud.estado}`
            });
        }

        // 2. Verificar stock de la herramienta en tiempo real
        const [herramientas] = await connection.query(
            'SELECT cantidad_disponible, estado FROM herramientas WHERE id = ? FOR UPDATE',
            [solicitud.herramienta_id]
        );

        if (herramientas.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'La herramienta ya no existe en el sistema'
            });
        }

        const herramienta = herramientas[0];
        const cantidadActual = parseInt(herramienta.cantidad_disponible, 10) || 0;

        if (cantidadActual < cantidadSolicitada) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `No hay suficiente stock. Solicitado: ${cantidadSolicitada}, Disponible: ${cantidadActual}`
            });
        }

        // 3. Actualizar solicitud a aprobada
        await connection.query(
            `UPDATE solicitudes 
             SET estado = 'aprobada', admin_revisor_id = ?, fecha_revision = NOW(), comentario_admin = ?
             WHERE id = ?`,
            [admin_id, comentario_admin || null, id]
        );

        // 4. Crear el registro en la tabla de prestamos
        const [prestamo] = await connection.query(
            `INSERT INTO prestamos 
    (solicitud_id, usuario_id, herramienta_id, admin_aprobador_id, fecha_prestamo, fecha_aprobacion, fecha_devolucion_estimada, observaciones, cantidad_prestada) 
    VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
            [
                id,
                solicitud.usuario_id,
                solicitud.herramienta_id,
                admin_id,
                solicitud.fecha_uso_estimada,
                solicitud.fecha_devolucion_estimada,
                `Aprobado por admin. ${comentario_admin || ''}`,
                cantidadSolicitada
            ]
        );

        // 5. Restar la cantidad correspondiente
        const nuevaCantidadDisponible = cantidadActual - cantidadSolicitada;
        const nuevoEstado = nuevaCantidadDisponible <= 0 ? 'prestado' : 'disponible';

        await connection.query(
            'UPDATE herramientas SET cantidad_disponible = ?, estado = ? WHERE id = ?',
            [nuevaCantidadDisponible, nuevoEstado, solicitud.herramienta_id]
        );

        // 6. Registrar en historial de auditoría
        await connection.query(
            `INSERT INTO historial (usuario_id, accion, entidad_tipo, entidad_id, detalles)
             VALUES (?, 'aprobar_solicitud', 'solicitud', ?, ?)`,
            [admin_id, id, `Solicitud aprobada. Préstamo ID: ${prestamo.insertId}. Unidades prestadas: ${cantidadSolicitada}. Restantes: ${nuevaCantidadDisponible}`]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Solicitud aprobada y préstamo creado exitosamente',
            prestamoId: prestamo.insertId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error aprobando solicitud:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    } finally {
        connection.release();
    }
};

// Rechazar solicitud (admin)
exports.rechazarSolicitud = async (req, res) => {
    try {
        const { id } = req.params;
        const { comentario_admin } = req.body;
        const admin_id = req.userId;

        const [solicitudes] = await db.query(
            'SELECT estado FROM solicitudes WHERE id = ?',
            [id]
        );

        if (solicitudes.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Solicitud no encontrada'
            });
        }

        if (solicitudes[0].estado !== 'pendiente') {
            return res.status(400).json({
                success: false,
                message: `La solicitud ya fue ${solicitudes[0].estado}`
            });
        }

        await db.query(
            `UPDATE solicitudes 
             SET estado = 'rechazada', admin_revisor_id = ?, fecha_revision = NOW(), comentario_admin = ?
             WHERE id = ?`,
            [admin_id, comentario_admin || 'Solicitud rechazada', id]
        );

        await db.query(
            `INSERT INTO historial (usuario_id, accion, entidad_tipo, entidad_id, detalles)
             VALUES (?, 'rechazar_solicitud', 'solicitud', ?, ?)`,
            [admin_id, id, comentario_admin || 'Sin comentarios']
        );

        res.json({
            success: true,
            message: 'Solicitud rechazada'
        });

    } catch (error) {
        console.error('Error rechazando solicitud:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

// Cancelar solicitud (usuario)
exports.cancelarSolicitud = async (req, res) => {
    try {
        const { id } = req.params;
        const usuario_id = req.userId;

        const [solicitudes] = await db.query(
            'SELECT estado, usuario_id FROM solicitudes WHERE id = ?',
            [id]
        );

        if (solicitudes.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Solicitud no encontrada'
            });
        }

        const solicitud = solicitudes[0];

        if (solicitud.usuario_id !== usuario_id) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para cancelar esta solicitud'
            });
        }

        if (solicitud.estado !== 'pendiente') {
            return res.status(400).json({
                success: false,
                message: `No puedes cancelar una solicitud que ya está ${solicitud.estado}`
            });
        }

        await db.query(
            `UPDATE solicitudes SET estado = 'cancelada' WHERE id = ?`,
            [id]
        );

        res.json({
            success: true,
            message: 'Solicitud cancelada correctamente'
        });

    } catch (error) {
        console.error('Error cancelando solicitud:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};

exports.misSolicitudes = async (req, res) => {
    try {
        const [solicitudes] = await db.query(`
            SELECT s.*, 
                   h.descripcion as herramienta_nombre, 
                   h.codigo_qr, 
                   h.imagen_url,
                   c.nombre as categoria_nombre,
                   ar.nombre as admin_revisor_nombre,
                   p.id as prestamo_id,
                   p.estado as prestamo_estado
            FROM solicitudes s
            INNER JOIN herramientas h ON s.herramienta_id = h.id
            LEFT JOIN categorias c ON h.categoria_id = c.id
            LEFT JOIN usuarios ar ON s.admin_revisor_id = ar.id
            LEFT JOIN prestamos p ON p.solicitud_id = s.id
            WHERE s.usuario_id = ?
            ORDER BY s.created_at DESC
        `, [req.userId]);

        res.json({
            success: true,
            solicitudes
        });

    } catch (error) {
        console.error('Error obteniendo mis solicitudes:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
};