const db = require('../config/database');

// Listar todos los préstamos (admin)
exports.listarPrestamos = async (req, res) => {
    try {
        const { estado } = req.query;

        let query = `
            SELECT p.*, 
                   u.nombre as usuario_nombre, u.email as usuario_email,
                   h.nombre as herramienta_nombre, h.codigo_qr, h.imagen_url,
                   h.cantidad_total, h.cantidad_disponible,
                   a.nombre as admin_aprobador_nombre
            FROM prestamos p
            INNER JOIN usuarios u ON p.usuario_id = u.id
            INNER JOIN herramientas h ON p.herramienta_id = h.id
            LEFT JOIN usuarios a ON p.admin_aprobador_id = a.id
        `;

        const params = [];
        if (estado) {
            query += ' WHERE p.estado = ?';
            params.push(estado);
        }
        query += ' ORDER BY p.created_at DESC';

        const [prestamos] = await db.query(query, params);
        res.json({ success: true, prestamos });

    } catch (error) {
        console.error('Error listando préstamos:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

// Listar préstamos del usuario actual
exports.misPrestamos = async (req, res) => {
    try {
        const [prestamos] = await db.query(`
            SELECT p.*, 
                   h.nombre as herramienta_nombre, h.codigo_qr, h.imagen_url,
                   h.cantidad_total, h.cantidad_disponible
            FROM prestamos p
            INNER JOIN herramientas h ON p.herramienta_id = h.id
            WHERE p.usuario_id = ?
            ORDER BY p.created_at DESC
        `, [req.userId]);

        res.json({ success: true, prestamos });

    } catch (error) {
        console.error('Error obteniendo mis préstamos:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

// Listar préstamos activos del usuario
exports.misPrestamosActivos = async (req, res) => {
    try {
        const [prestamos] = await db.query(`
            SELECT p.*, 
                   h.nombre as herramienta_nombre, 
                   h.codigo_qr, 
                   h.imagen_url,
                   h.cantidad_total,
                   h.cantidad_disponible,
                   s.fecha_uso_estimada, 
                   s.fecha_devolucion_estimada
            FROM prestamos p
            INNER JOIN herramientas h ON p.herramienta_id = h.id
            LEFT JOIN solicitudes s ON p.solicitud_id = s.id
            WHERE p.usuario_id = ? AND p.estado = 'activo'
            ORDER BY p.created_at DESC
        `, [req.userId]);

        res.json({ success: true, prestamos });

    } catch (error) {
        console.error('Error obteniendo préstamos activos:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

// Listar préstamos activos (admin)
exports.prestamosActivos = async (req, res) => {
    try {
        const [prestamos] = await db.query(`
            SELECT p.*, 
                   u.nombre as usuario_nombre, u.email as usuario_email,
                   h.nombre as herramienta_nombre, h.codigo_qr,
                   h.cantidad_total, h.cantidad_disponible
            FROM prestamos p
            INNER JOIN usuarios u ON p.usuario_id = u.id
            INNER JOIN herramientas h ON p.herramienta_id = h.id
            WHERE p.estado = 'activo'
            ORDER BY p.fecha_devolucion_estimada ASC
        `);

        res.json({ success: true, prestamos });

    } catch (error) {
        console.error('Error obteniendo préstamos activos:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

// Obtener detalles de un préstamo
exports.obtenerPrestamo = async (req, res) => {
    try {
        const { id } = req.params;

        const [prestamos] = await db.query(`
            SELECT p.*, 
                   h.nombre as herramienta_nombre, 
                   h.codigo_qr, 
                   h.imagen_url,
                   h.estado as estado_herramienta,
                   h.cantidad_total,
                   h.cantidad_disponible,
                   u.nombre as usuario_nombre, 
                   u.email as usuario_email,
                   a.nombre as admin_aprobador_nombre
            FROM prestamos p
            INNER JOIN herramientas h ON p.herramienta_id = h.id
            INNER JOIN usuarios u ON p.usuario_id = u.id
            LEFT JOIN usuarios a ON p.admin_aprobador_id = a.id
            WHERE p.id = ?
        `, [id]);

        if (prestamos.length === 0) {
            return res.status(404).json({ success: false, message: 'Préstamo no encontrado' });
        }

        res.json({ success: true, prestamo: prestamos[0] });

    } catch (error) {
        console.error('Error obteniendo préstamo:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

// Crear préstamo (desde escaneo QR)
exports.crearPrestamo = async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        const { herramienta_id, fecha_devolucion_estimada, observaciones, cantidad_prestada } = req.body;
        const usuario_id = req.userId;

        if (!herramienta_id || !fecha_devolucion_estimada) {
            return res.status(400).json({
                success: false,
                message: 'ID de herramienta y fecha de devolución son requeridos'
            });
        }

        const cantidad = parseInt(cantidad_prestada) || 1;

        await connection.beginTransaction();

        const [herramientas] = await connection.query(
            'SELECT id, nombre, estado, cantidad_disponible FROM herramientas WHERE id = ? FOR UPDATE',
            [herramienta_id]
        );

        if (herramientas.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Herramienta no encontrada' });
        }

        const herramienta = herramientas[0];

        if (herramienta.cantidad_disponible < cantidad) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Solo hay ${herramienta.cantidad_disponible} unidad(es) disponible(s)`
            });
        }

        const nuevaCantidadDisponible = herramienta.cantidad_disponible - cantidad;

        const [result] = await connection.query(
            `INSERT INTO prestamos 
            (usuario_id, herramienta_id, fecha_prestamo, fecha_devolucion_estimada, observaciones, estado, cantidad_prestada) 
            VALUES (?, ?, NOW(), ?, ?, 'activo', ?)`,
            [usuario_id, herramienta_id, fecha_devolucion_estimada, observaciones || null, cantidad]
        );

        // Actualizar cantidad disponible y estado
        const nuevoEstado = nuevaCantidadDisponible === 0 ? 'prestado' : 'disponible';
        await connection.query(
            'UPDATE herramientas SET cantidad_disponible = ?, estado = ? WHERE id = ?',
            [nuevaCantidadDisponible, nuevoEstado, herramienta_id]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Préstamo registrado exitosamente',
            prestamoId: result.insertId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error creando préstamo:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    } finally {
        connection.release();
    }
};

// Registrar devolución
exports.devolverHerramienta = async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        const { id } = req.params;
        const observaciones = req.body?.observaciones || null;

        await connection.beginTransaction();

        const [prestamos] = await connection.query(
            'SELECT id, herramienta_id, estado, cantidad_prestada FROM prestamos WHERE id = ?',
            [id]
        );

        if (prestamos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Préstamo no encontrado' });
        }

        const prestamo = prestamos[0];

        if (prestamo.estado !== 'activo') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'El préstamo ya fue devuelto' });
        }

        await connection.query(
            `UPDATE prestamos 
            SET estado = 'devuelto', fecha_devolucion_real = NOW(), 
                observaciones = CONCAT(IFNULL(observaciones, ''), ' | Devolución: ', ?)
            WHERE id = ?`,
            [observaciones || 'Sin observaciones', id]
        );

        // Devolver las unidades a cantidad_disponible
        const cantidadDevuelta = prestamo.cantidad_prestada || 1;
        const [herramienta] = await connection.query(
            'SELECT cantidad_disponible, cantidad_total FROM herramientas WHERE id = ? FOR UPDATE',
            [prestamo.herramienta_id]
        );

        const nuevaCantidadDisponible = Math.min(
            herramienta[0].cantidad_disponible + cantidadDevuelta,
            herramienta[0].cantidad_total
        );
        const nuevoEstado = nuevaCantidadDisponible > 0 ? 'disponible' : 'prestado';

        await connection.query(
            'UPDATE herramientas SET cantidad_disponible = ?, estado = ? WHERE id = ?',
            [nuevaCantidadDisponible, nuevoEstado, prestamo.herramienta_id]
        );

        await connection.commit();

        res.json({ success: true, message: 'Devolución registrada exitosamente' });

    } catch (error) {
        await connection.rollback();
        console.error('Error registrando devolución:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    } finally {
        connection.release();
    }
};

module.exports = exports;