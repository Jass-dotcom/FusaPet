-- ============================================================
-- FusaPet - Configuracion de permisos (RLS), datos base y admin
-- Ejecutar UNA VEZ en: Supabase Dashboard -> SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1) Privilegios base para los roles `anon` y `authenticated`
--    (sin esto la app no puede leer NADA: lanza permisos denegados)
-- ------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ------------------------------------------------------------
-- 2) Funcion auxiliar: ?el usuario actual es administrador?
--    (SECURITY DEFINER evita recursion RLS sobre `usuarios`)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios WHERE id = auth.uid() AND rol = 'administrador' AND activo IS TRUE
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE);
$$;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

-- ------------------------------------------------------------
-- 3) Habilitar RLS en todas las tablas
-- ------------------------------------------------------------
ALTER TABLE public.comunas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barrios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.especies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS contacto_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS moderado boolean NOT NULL DEFAULT false;
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS revision_estado text NOT NULL DEFAULT 'aprobado';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reportes_revision_estado_check' AND conrelid = 'public.reportes'::regclass) THEN
    ALTER TABLE public.reportes ADD CONSTRAINT reportes_revision_estado_check CHECK (revision_estado IN ('pendiente','aprobado','rechazado'));
  END IF;
END $$;
ALTER TABLE public.avistamientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos_reporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos_avistamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.denuncias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

-- Retirar políticas previas para que una regla permisiva antigua no se sume
-- a las políticas seguras de este archivo (las políticas RLS son OR).
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('comunas','barrios','especies','usuarios','mascotas','reportes',
                        'avistamientos','fotos_reporte','fotos_avistamiento','denuncias','notificaciones')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4) Politicas de acceso
-- ------------------------------------------------------------

-- ===== comunas: lectura publica, edicion solo admin =====
DROP POLICY IF EXISTS p_comunas_select ON public.comunas;
CREATE POLICY p_comunas_select ON public.comunas FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_comunas_admin ON public.comunas;
CREATE POLICY p_comunas_admin ON public.comunas FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ===== barrios: lectura publica, edicion solo admin =====
DROP POLICY IF EXISTS p_barrios_select ON public.barrios;
CREATE POLICY p_barrios_select ON public.barrios FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_barrios_admin ON public.barrios;
CREATE POLICY p_barrios_admin ON public.barrios FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ===== especies: lectura publica (catalogo), sin escritura publica =====
DROP POLICY IF EXISTS p_especies_select ON public.especies;
CREATE POLICY p_especies_select ON public.especies FOR SELECT TO anon, authenticated USING (true);

-- ===== usuarios: perfil privado; contacto visible solo en reportes activos =====
DROP POLICY IF EXISTS p_usuarios_select ON public.usuarios;
CREATE POLICY p_usuarios_select ON public.usuarios FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.reportes r
      WHERE r.usuario_id = usuarios.id AND r.estado = 'publicado'
        AND r.contacto_visible = true AND r.moderado = false AND r.revision_estado = 'aprobado'
    )
  );
DROP POLICY IF EXISTS p_usuarios_insert ON public.usuarios;
CREATE POLICY p_usuarios_insert ON public.usuarios FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND rol::text = 'usuario' AND activo IS TRUE);
DROP POLICY IF EXISTS p_usuarios_update ON public.usuarios;
CREATE POLICY p_usuarios_update ON public.usuarios FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin()) WITH CHECK (id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_usuarios_delete ON public.usuarios;
CREATE POLICY p_usuarios_delete ON public.usuarios FOR DELETE TO authenticated USING (public.is_admin());

-- El cliente solo puede leer nombre y teléfono para reportes activos. Correo,
-- rol y estado se entregan exclusivamente al titular o al administrador vía RPC.
REVOKE SELECT ON TABLE public.usuarios FROM anon, authenticated;
GRANT SELECT (id, nombre, telefono) ON TABLE public.usuarios TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_my_profile() RETURNS SETOF public.usuarios
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.usuarios WHERE id = auth.uid(); $$;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_users() RETURNS SETOF public.usuarios
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  RETURN QUERY SELECT * FROM public.usuarios ORDER BY created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- ===== mascotas: lectura publica (embed en reportes), escritura solo dueno =====
DROP POLICY IF EXISTS p_mascotas_select ON public.mascotas;
CREATE POLICY p_mascotas_select ON public.mascotas FOR SELECT TO anon, authenticated USING (
  usuario_id = auth.uid() OR public.is_admin() OR EXISTS (
    SELECT 1 FROM public.reportes r WHERE r.mascota_id = mascotas.id
      AND r.moderado = false AND r.revision_estado = 'aprobado'
  )
);
DROP POLICY IF EXISTS p_mascotas_insert ON public.mascotas;
CREATE POLICY p_mascotas_insert ON public.mascotas FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_mascotas_update ON public.mascotas;
CREATE POLICY p_mascotas_update ON public.mascotas FOR UPDATE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin()) WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_mascotas_delete ON public.mascotas;
CREATE POLICY p_mascotas_delete ON public.mascotas FOR DELETE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin());

-- ===== reportes: lectura publica, escritura solo autor/admin =====
DROP POLICY IF EXISTS p_reportes_select ON public.reportes;
CREATE POLICY p_reportes_select ON public.reportes FOR SELECT TO anon, authenticated
  USING ((moderado = false AND revision_estado = 'aprobado') OR usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_reportes_insert ON public.reportes;
CREATE POLICY p_reportes_insert ON public.reportes FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_reportes_update ON public.reportes;
CREATE POLICY p_reportes_update ON public.reportes FOR UPDATE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin()) WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_reportes_delete ON public.reportes;
CREATE POLICY p_reportes_delete ON public.reportes FOR DELETE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin());

-- ===== avistamientos: lectura publica, escritura solo autor =====
DROP POLICY IF EXISTS p_avistamientos_select ON public.avistamientos;
CREATE POLICY p_avistamientos_select ON public.avistamientos FOR SELECT TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM public.reportes r WHERE r.id = reporte_id
    AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR r.usuario_id = auth.uid() OR public.is_admin()))
);
DROP POLICY IF EXISTS p_avistamientos_insert ON public.avistamientos;
CREATE POLICY p_avistamientos_insert ON public.avistamientos FOR INSERT TO authenticated WITH CHECK (
  (usuario_id = auth.uid() OR public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.reportes r WHERE r.id = reporte_id
      AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR public.is_admin())
  )
);
DROP POLICY IF EXISTS p_avistamientos_update ON public.avistamientos;
CREATE POLICY p_avistamientos_update ON public.avistamientos FOR UPDATE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin()) WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_avistamientos_delete ON public.avistamientos;
CREATE POLICY p_avistamientos_delete ON public.avistamientos FOR DELETE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin());

-- ===== fotos_reporte / fotos_avistamiento: lectura publica, insercion autenticada =====
DROP POLICY IF EXISTS p_fotos_reporte_select ON public.fotos_reporte;
CREATE POLICY p_fotos_reporte_select ON public.fotos_reporte FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reportes r WHERE r.id = reporte_id
      AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR r.usuario_id = auth.uid() OR public.is_admin())
  ));
DROP POLICY IF EXISTS p_fotos_reporte_insert ON public.fotos_reporte;
CREATE POLICY p_fotos_reporte_insert ON public.fotos_reporte FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.reportes r WHERE r.id = reporte_id AND (r.usuario_id = auth.uid() OR public.is_admin()))
  );

DROP POLICY IF EXISTS p_fotos_avistamiento_select ON public.fotos_avistamiento;
CREATE POLICY p_fotos_avistamiento_select ON public.fotos_avistamiento FOR SELECT TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM public.avistamientos a JOIN public.reportes r ON r.id = a.reporte_id
    WHERE a.id = avistamiento_id
      AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR r.usuario_id = auth.uid() OR public.is_admin()))
);
DROP POLICY IF EXISTS p_fotos_avistamiento_insert ON public.fotos_avistamiento;
CREATE POLICY p_fotos_avistamiento_insert ON public.fotos_avistamiento FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.avistamientos a JOIN public.reportes r ON r.id = a.reporte_id
      WHERE a.id = avistamiento_id AND (a.usuario_id = auth.uid() OR public.is_admin())
        AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR public.is_admin()))
  );

-- ===== denuncias: solo admin puede ver/moderar; cualquier autenticado denuncia =====
DROP POLICY IF EXISTS p_denuncias_select ON public.denuncias;
CREATE POLICY p_denuncias_select ON public.denuncias FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS p_denuncias_insert ON public.denuncias;
CREATE POLICY p_denuncias_insert ON public.denuncias FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid());
DROP POLICY IF EXISTS p_denuncias_update ON public.denuncias;
CREATE POLICY p_denuncias_update ON public.denuncias FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ===== notificaciones: cada quien ve/actualiza las propias =====
DROP POLICY IF EXISTS p_notificaciones_select ON public.notificaciones;
CREATE POLICY p_notificaciones_select ON public.notificaciones FOR SELECT TO authenticated USING (usuario_id = auth.uid());
-- Las notificaciones se crean desde el trigger de avistamientos, nunca desde el cliente.
DROP POLICY IF EXISTS p_notificaciones_insert ON public.notificaciones;
DROP POLICY IF EXISTS p_notificaciones_update ON public.notificaciones;
CREATE POLICY p_notificaciones_update ON public.notificaciones FOR UPDATE TO authenticated USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- Las cuentas desactivadas no pueden seguir operando usando una sesión previa.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comunas','barrios','especies','mascotas','reportes',
    'avistamientos','fotos_reporte','fotos_avistamiento','denuncias','notificaciones']
  LOOP
    EXECUTE format('CREATE POLICY p_active_account ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())', t);
  END LOOP;
END $$;
CREATE POLICY p_active_account_select ON public.usuarios AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY p_active_account_update ON public.usuarios AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());
CREATE POLICY p_active_account_delete ON public.usuarios AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_active_user());

-- ============================================================
-- 5) Datos base (comunas, barrios y especies)
--    La app exige comuna, barrio y especie para crear reportes.
-- ============================================================
-- Los reportes anteriores guardaban la ubicación del dispositivo que publicaba,
-- no necesariamente el lugar del incidente. Limpia esos puntos una sola vez para
-- evitar exponer ubicaciones personales o mostrar un sitio equivocado.
CREATE TABLE IF NOT EXISTS public.fusapet_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE public.fusapet_migrations FROM anon, authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.fusapet_migrations WHERE version='2026-09-report-location') THEN
    UPDATE public.reportes SET latitud=NULL, longitud=NULL
    WHERE latitud IS NOT NULL OR longitud IS NOT NULL;
    INSERT INTO public.fusapet_migrations(version) VALUES ('2026-09-report-location')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;

INSERT INTO public.especies (nombre)
SELECT 'Perro'   WHERE NOT EXISTS (SELECT 1 FROM public.especies WHERE nombre = 'Perro');
INSERT INTO public.especies (nombre)
SELECT 'Gato'    WHERE NOT EXISTS (SELECT 1 FROM public.especies WHERE nombre = 'Gato');
INSERT INTO public.especies (nombre)
SELECT 'Ave'     WHERE NOT EXISTS (SELECT 1 FROM public.especies WHERE nombre = 'Ave');
INSERT INTO public.especies (nombre)
SELECT 'Conejo'  WHERE NOT EXISTS (SELECT 1 FROM public.especies WHERE nombre = 'Conejo');
INSERT INTO public.especies (nombre)
SELECT 'Hamster' WHERE NOT EXISTS (SELECT 1 FROM public.especies WHERE nombre = 'Hamster');
INSERT INTO public.especies (nombre)
SELECT 'Otro'    WHERE NOT EXISTS (SELECT 1 FROM public.especies WHERE nombre = 'Otro');

-- Fusagasugá se organiza en seis comunas urbanas. Direcciones (calle/carrera
-- y número) se capturan en cada reporte; los barrios no tienen una dirección única.
INSERT INTO public.comunas (nombre)
SELECT nombre FROM (VALUES ('Norte'),('Oriental'),('Centro'),('Suroriental'),('Occidental'),('Suroccidental')) AS x(nombre)
WHERE NOT EXISTS (SELECT 1 FROM public.comunas c WHERE c.nombre=x.nombre);

INSERT INTO public.barrios (nombre, comuna_id)
SELECT x.barrio,c.id
FROM (VALUES
 ('Norte','La Independencia'),('Norte','San Antonio'),('Norte','Mi Tesoro'),('Norte','Villa Armerita'),('Norte','La Esmeralda I'),('Norte','La Esmeralda II'),('Norte','El Lucero'),('Norte','Carlos Lleras'),('Norte','El Progreso'),('Norte','Los Fundadores'),('Norte','El Edén'),('Norte','La Nueva Esperanza'),('Norte','Los Andes'),('Norte','José Antonio Galán'),('Norte','Santa Librada'),('Norte','Gaitán I'),('Norte','Gaitán II'),('Norte','La Florida'),('Norte','La Cabaña'),
 ('Oriental','Los Robles'),('Oriental','El Mirador de Bonet'),('Oriental','Coburgo'),('Oriental','El Tejar'),('Oriental','Bella Vista'),('Oriental','Bella Vista II'),('Oriental','Altos de Pekín'),('Oriental','Pekín'),('Oriental','Cedritos'),('Oriental','Santa María de los Ángeles'),('Oriental','Villa Aránzazu'),('Oriental','Antonio Nariño'),
 ('Centro','Santander'),('Centro','Emilio Sierra'),('Centro','Centro'),('Centro','Potosí'),('Centro','Luxemburgo'),('Centro','Olaya'),
 ('Suroriental','Balmoral'),('Suroriental','Floridablanca'),('Suroriental','El Mirador'),('Suroriental','Pablo Bello'),('Suroriental','Pardo Leal'),('Suroriental','Santa Rosa'),('Suroriental','Fusacatán'),('Suroriental','Los Comuneros'),('Suroriental','Prados de Bethel'),('Suroriental','Prados de Alta Gracia'),('Suroriental','Las Delicias'),('Suroriental','El Obrero'),('Suroriental','La Macarena'),('Suroriental','San Fernando I'),('Suroriental','San Fernando II'),('Suroriental','Santa Bárbara'),('Suroriental','Villa Leidy'),
 ('Occidental','Manila'),('Occidental','San Mateo'),('Occidental','Santa Ana Campestre'),('Occidental','Teresita I'),('Occidental','Teresita II'),('Occidental','Teresita III'),('Occidental','Quintas del Manila'),('Occidental','Santa Anita'),('Occidental','Piedra Grande'),('Occidental','Villa Country'),('Occidental','El Caribe'),('Occidental','Fontanar'),('Occidental','San Jorge'),('Occidental','Ciudadela'),('Occidental','Cootransfusa'),('Occidental','Mandalay'),('Occidental','Antiguo Balmoral'),('Occidental','Nuevo Balmoral'),('Occidental','Marsella'),
 ('Suroccidental','Quince de Mayo'),('Suroccidental','Villa Patricia'),('Suroccidental','San Marcos'),('Suroccidental','Los Cámbulos'),('Suroccidental','La Gran Colombia'),('Suroccidental','El Futuro'),('Suroccidental','Maíz Amarillo'),('Suroccidental','La Venta'),('Suroccidental','La Pampa'),('Suroccidental','La Caja Agraria'),('Suroccidental','San Martín de los Olivos'),('Suroccidental','Comfenalco'),('Suroccidental','Villa Rosita'),('Suroccidental','Altamira'),('Suroccidental','Llano Largo'),('Suroccidental','Llano Verde'),('Suroccidental','Llano Alto San Francisco'),('Suroccidental','Ciudad Jardín'),('Suroccidental','Ciudad Ebén-Ezer'),('Suroccidental','Girasoles')
) AS x(comuna,barrio)
JOIN public.comunas c ON c.nombre=x.comuna
WHERE NOT EXISTS (SELECT 1 FROM public.barrios b WHERE b.nombre=x.barrio AND b.comuna_id=c.id);

-- Limpia únicamente los datos de demostración del SQL anterior cuando ningún
-- reporte los utiliza. Los registros usados se conservan para evitar romper datos.
DELETE FROM public.barrios b USING public.comunas c
WHERE b.comuna_id=c.id AND c.nombre IN ('Comuna Norte','Comuna Sur','Comuna Este','Comuna Oeste')
  AND b.nombre IN ('Centro','La Estancia','Juan Lozano','Bosa Nueva','Santa Ana','El Carmen','El Bosque','Ciudadela')
  AND NOT EXISTS (SELECT 1 FROM public.reportes r WHERE r.barrio_id=b.id);
DELETE FROM public.comunas c
WHERE c.nombre IN ('Comuna Norte','Comuna Sur','Comuna Este','Comuna Oeste')
  AND NOT EXISTS (SELECT 1 FROM public.barrios b WHERE b.comuna_id=c.id);

-- ============================================================
-- 6) CREAR PERFIL AUTOMATICAMENTE AL REGISTRARSE
--    (Recomendado si en Auth -> Email esta activado el "Confirm email":
--     de lo contrario el registro desde la app no podria crear la fila
--     en `usuarios` hasta confirmar el correo).
--    Nota: este archivo es IDEMPOTENTE, puedes volver a ejecutarlo
--    completo sin romper nada.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usuarios (id, nombre, email, telefono, rol)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    new.email,
    coalesce(new.raw_user_meta_data->>'telefono', ''),
    'usuario'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 7) ADMINISTRADORES
--    Este script no cambia roles de cuentas existentes. Asigna el rol de
--    administrador por un procedimiento administrativo controlado; no se
--    desactivan triggers de proteccion ni se incluye un correo fijo aquí.
-- ============================================================

-- ============================================================
-- 8) VALORES DE ENUM FALTANTES PARA LA APP
--    Aditivo y seguro (no borra nada). Necesario para:
--      - registrar usuarios normales (rol 'usuario')
--      - reportes tipo avistamiento y adopcion
--      - desestimar una denuncia
--    Si un valor ya existe, "IF NOT EXISTS" lo ignora.
-- ============================================================
ALTER TYPE public.rol_usuario ADD VALUE IF NOT EXISTS 'usuario';
ALTER TYPE public.rol_usuario ADD VALUE IF NOT EXISTS 'administrador';
ALTER TYPE public.tipo_reporte ADD VALUE IF NOT EXISTS 'avistado';
ALTER TYPE public.tipo_reporte ADD VALUE IF NOT EXISTS 'adopcion';
ALTER TYPE public.estado_denuncia ADD VALUE IF NOT EXISTS 'desestimada';

-- Impedir que una cuenta normal se asigne el rol de administrador mediante
-- INSERT directo o UPDATE de su perfil. El alta por trigger siempre crea rol usuario.
CREATE OR REPLACE FUNCTION public.protect_user_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.rol IS DISTINCT FROM OLD.rol
      OR NEW.activo IS DISTINCT FROM OLD.activo
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.id IS DISTINCT FROM OLD.id)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar los campos protegidos de la cuenta';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_user_role_before_update ON public.usuarios;
CREATE TRIGGER protect_user_role_before_update
  BEFORE UPDATE OF rol, activo, email, id ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_role();

CREATE OR REPLACE FUNCTION public.protect_report_moderation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.moderado IS TRUE AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Solo un administrador puede moderar publicaciones';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.moderado IS DISTINCT FROM OLD.moderado AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede moderar publicaciones';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_report_moderation_before_update ON public.reportes;
CREATE TRIGGER protect_report_moderation_before_update
  BEFORE INSERT OR UPDATE OF moderado ON public.reportes
  FOR EACH ROW EXECUTE FUNCTION public.protect_report_moderation();

CREATE OR REPLACE FUNCTION public.protect_report_approval_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_admin() AND NEW.revision_estado <> 'pendiente' THEN
      RAISE EXCEPTION 'Los reportes de usuarios deben quedar pendientes de aprobación';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.revision_estado IS DISTINCT FROM OLD.revision_estado AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede aprobar o rechazar reportes';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_report_approval_state_before_write ON public.reportes;
CREATE TRIGGER protect_report_approval_state_before_write
  BEFORE INSERT OR UPDATE OF revision_estado ON public.reportes
  FOR EACH ROW EXECUTE FUNCTION public.protect_report_approval_state();

CREATE OR REPLACE FUNCTION public.admin_moderate_flag(flag_id text, new_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_report_id text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF new_status NOT IN ('aprobada', 'desestimada') THEN
    RAISE EXCEPTION 'Estado de denuncia no válido';
  END IF;
  SELECT reporte_id::text INTO target_report_id FROM public.denuncias WHERE id::text = flag_id;
  IF target_report_id IS NULL THEN RAISE EXCEPTION 'Denuncia no encontrada'; END IF;
  UPDATE public.denuncias SET estado = new_status::public.estado_denuncia WHERE id::text = flag_id;
  UPDATE public.reportes SET moderado = EXISTS (
    SELECT 1 FROM public.denuncias d
    WHERE d.reporte_id::text = target_report_id AND d.estado::text = 'aprobada'
  ) WHERE id::text = target_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_moderate_flag(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_moderate_flag(text, text) TO authenticated;

-- Al registrar un avistamiento, crear la notificación en el servidor. Así el
-- cliente no puede enviar notificaciones falsas a otros usuarios.
CREATE OR REPLACE FUNCTION public.notify_report_owner_on_sighting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE owner_id uuid;
BEGIN
  SELECT usuario_id INTO owner_id FROM public.reportes WHERE id = NEW.reporte_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.usuario_id THEN
    INSERT INTO public.notificaciones (usuario_id, reporte_id, avistamiento_id, mensaje)
    VALUES (
      owner_id,
      NEW.reporte_id,
      NEW.id,
      CASE
        WHEN coalesce(NEW.informacion_adicional, '') LIKE 'MASCOTA_ENCONTRADA:%'
          THEN 'Alguien informó que encontró tu mascota'
        ELSE 'Hay un nuevo avistamiento en tu reporte'
      END
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notify_report_owner_after_sighting ON public.avistamientos;
CREATE TRIGGER notify_report_owner_after_sighting
  AFTER INSERT ON public.avistamientos
  FOR EACH ROW EXECUTE FUNCTION public.notify_report_owner_on_sighting();

-- Fotografías públicas de reportes: lectura pública, carga solo en la carpeta
-- propia del usuario y límite de tamaño/tipo aplicado por Storage.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('report-photos', 'report-photos', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
UPDATE public.fotos_reporte SET url = split_part(url, '/report-photos/', 2)
WHERE url LIKE '%/report-photos/%';
DROP POLICY IF EXISTS p_report_photos_scoped_read ON storage.objects;
DROP POLICY IF EXISTS p_report_photos_public_read ON storage.objects;
CREATE POLICY p_report_photos_scoped_read ON storage.objects FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'report-photos'
    AND EXISTS (
      SELECT 1 FROM public.fotos_reporte f JOIN public.reportes r ON r.id = f.reporte_id
      WHERE f.url = objects.name
        AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR r.usuario_id = auth.uid() OR public.is_admin())
    )
    OR bucket_id = 'report-photos'
    AND EXISTS (
      SELECT 1 FROM public.fotos_avistamiento fa
      JOIN public.avistamientos a ON a.id = fa.avistamiento_id
      JOIN public.reportes r ON r.id = a.reporte_id
      WHERE fa.url = objects.name
        AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR r.usuario_id = auth.uid() OR public.is_admin())
    )
  );
DROP POLICY IF EXISTS p_report_photos_owner_insert ON storage.objects;
CREATE POLICY p_report_photos_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'report-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS p_report_photos_active_only ON storage.objects;
CREATE POLICY p_report_photos_active_only ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id <> 'report-photos' OR public.is_active_user())
  WITH CHECK (bucket_id <> 'report-photos' OR public.is_active_user());
