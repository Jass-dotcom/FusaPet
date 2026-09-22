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
    SELECT 1 FROM public.usuarios WHERE id = auth.uid() AND rol = 'administrador'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ------------------------------------------------------------
-- 3) Habilitar RLS en todas las tablas
-- ------------------------------------------------------------
ALTER TABLE public.comunas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barrios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.especies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avistamientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos_reporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos_avistamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.denuncias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

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

-- ===== usuarios: lectura publica (para mostrar contacto en reportes) =====
DROP POLICY IF EXISTS p_usuarios_select ON public.usuarios;
CREATE POLICY p_usuarios_select ON public.usuarios FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_usuarios_insert ON public.usuarios;
CREATE POLICY p_usuarios_insert ON public.usuarios FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS p_usuarios_update ON public.usuarios;
CREATE POLICY p_usuarios_update ON public.usuarios FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin()) WITH CHECK (id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_usuarios_delete ON public.usuarios;
CREATE POLICY p_usuarios_delete ON public.usuarios FOR DELETE TO authenticated USING (public.is_admin());

-- ===== mascotas: lectura publica (embed en reportes), escritura solo dueno =====
DROP POLICY IF EXISTS p_mascotas_select ON public.mascotas;
CREATE POLICY p_mascotas_select ON public.mascotas FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_mascotas_insert ON public.mascotas;
CREATE POLICY p_mascotas_insert ON public.mascotas FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_mascotas_update ON public.mascotas;
CREATE POLICY p_mascotas_update ON public.mascotas FOR UPDATE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin()) WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_mascotas_delete ON public.mascotas;
CREATE POLICY p_mascotas_delete ON public.mascotas FOR DELETE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin());

-- ===== reportes: lectura publica, escritura solo autor/admin =====
DROP POLICY IF EXISTS p_reportes_select ON public.reportes;
CREATE POLICY p_reportes_select ON public.reportes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_reportes_insert ON public.reportes;
CREATE POLICY p_reportes_insert ON public.reportes FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_reportes_update ON public.reportes;
CREATE POLICY p_reportes_update ON public.reportes FOR UPDATE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin()) WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_reportes_delete ON public.reportes;
CREATE POLICY p_reportes_delete ON public.reportes FOR DELETE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin());

-- ===== avistamientos: lectura publica, escritura solo autor =====
DROP POLICY IF EXISTS p_avistamientos_select ON public.avistamientos;
CREATE POLICY p_avistamientos_select ON public.avistamientos FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_avistamientos_insert ON public.avistamientos;
CREATE POLICY p_avistamientos_insert ON public.avistamientos FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_avistamientos_update ON public.avistamientos;
CREATE POLICY p_avistamientos_update ON public.avistamientos FOR UPDATE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin()) WITH CHECK (usuario_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p_avistamientos_delete ON public.avistamientos;
CREATE POLICY p_avistamientos_delete ON public.avistamientos FOR DELETE TO authenticated USING (usuario_id = auth.uid() OR public.is_admin());

-- ===== fotos_reporte / fotos_avistamiento: lectura publica, insercion autenticada =====
DROP POLICY IF EXISTS p_fotos_reporte_select ON public.fotos_reporte;
CREATE POLICY p_fotos_reporte_select ON public.fotos_reporte FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_fotos_reporte_insert ON public.fotos_reporte;
CREATE POLICY p_fotos_reporte_insert ON public.fotos_reporte FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS p_fotos_avistamiento_select ON public.fotos_avistamiento;
CREATE POLICY p_fotos_avistamiento_select ON public.fotos_avistamiento FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_fotos_avistamiento_insert ON public.fotos_avistamiento;
CREATE POLICY p_fotos_avistamiento_insert ON public.fotos_avistamiento FOR INSERT TO authenticated WITH CHECK (true);

-- ===== denuncias: solo admin puede ver/moderar; cualquier autenticado denuncia =====
DROP POLICY IF EXISTS p_denuncias_select ON public.denuncias;
CREATE POLICY p_denuncias_select ON public.denuncias FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS p_denuncias_insert ON public.denuncias;
CREATE POLICY p_denuncias_insert ON public.denuncias FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS p_denuncias_update ON public.denuncias;
CREATE POLICY p_denuncias_update ON public.denuncias FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ===== notificaciones: cada quien ve/actualiza las propias =====
DROP POLICY IF EXISTS p_notificaciones_select ON public.notificaciones;
CREATE POLICY p_notificaciones_select ON public.notificaciones FOR SELECT TO authenticated USING (usuario_id = auth.uid());
DROP POLICY IF EXISTS p_notificaciones_insert ON public.notificaciones;
CREATE POLICY p_notificaciones_insert ON public.notificaciones FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS p_notificaciones_update ON public.notificaciones;
CREATE POLICY p_notificaciones_update ON public.notificaciones FOR UPDATE TO authenticated USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- ============================================================
-- 5) Datos base (comunas, barrios y especies)
--    La app exige comuna, barrio y especie para crear reportes.
-- ============================================================
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

INSERT INTO public.comunas (nombre)
SELECT 'Comuna Norte'   WHERE NOT EXISTS (SELECT 1 FROM public.comunas WHERE nombre = 'Comuna Norte');
INSERT INTO public.barrios (nombre, comuna_id)
SELECT b, c.id FROM (SELECT 'Centro' AS b UNION ALL SELECT 'La Estancia') x, public.comunas c
WHERE c.nombre = 'Comuna Norte' AND NOT EXISTS (SELECT 1 FROM public.barrios WHERE nombre = x.b);

INSERT INTO public.comunas (nombre)
SELECT 'Comuna Sur'     WHERE NOT EXISTS (SELECT 1 FROM public.comunas WHERE nombre = 'Comuna Sur');
INSERT INTO public.barrios (nombre, comuna_id)
SELECT b, c.id FROM (SELECT 'Juan Lozano' AS b UNION ALL SELECT 'Bosa Nueva') x, public.comunas c
WHERE c.nombre = 'Comuna Sur' AND NOT EXISTS (SELECT 1 FROM public.barrios WHERE nombre = x.b);

INSERT INTO public.comunas (nombre)
SELECT 'Comuna Este'    WHERE NOT EXISTS (SELECT 1 FROM public.comunas WHERE nombre = 'Comuna Este');
INSERT INTO public.barrios (nombre, comuna_id)
SELECT b, c.id FROM (SELECT 'Santa Ana' AS b UNION ALL SELECT 'El Carmen') x, public.comunas c
WHERE c.nombre = 'Comuna Este' AND NOT EXISTS (SELECT 1 FROM public.barrios WHERE nombre = x.b);

INSERT INTO public.comunas (nombre)
SELECT 'Comuna Oeste'   WHERE NOT EXISTS (SELECT 1 FROM public.comunas WHERE nombre = 'Comuna Oeste');
INSERT INTO public.barrios (nombre, comuna_id)
SELECT b, c.id FROM (SELECT 'El Bosque' AS b UNION ALL SELECT 'Ciudadela') x, public.comunas c
WHERE c.nombre = 'Comuna Oeste' AND NOT EXISTS (SELECT 1 FROM public.barrios WHERE nombre = x.b);

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
-- 7) PROMOVER A UN USUARIO COMO ADMINISTRADOR
--    Cambia TU_EMAIL por el correo de la cuenta a administrar y
--    descomenta/ejecuta la linea. Repitelo por cada admin.
-- ============================================================
-- UPDATE public.usuarios SET rol = 'administrador'
--   WHERE email = 'TU_EMAIL@correo.com';

-- ============================================================
-- 8) VALORES DE ENUM FALTANTES PARA LA APP
--    Aditivo y seguro (no borra nada). Necesario para:
--      - registrar usuarios normales (rol 'usuario')
--      - reportes tipo avistamiento y adopcion
--      - desestimar una denuncia
--    Si un valor ya existe, "IF NOT EXISTS" lo ignora.
-- ============================================================
ALTER TYPE public.rol_usuario ADD VALUE IF NOT EXISTS 'usuario';
ALTER TYPE public.tipo_reporte ADD VALUE IF NOT EXISTS 'avistado';
ALTER TYPE public.tipo_reporte ADD VALUE IF NOT EXISTS 'adopcion';
ALTER TYPE public.estado_denuncia ADD VALUE IF NOT EXISTS 'desestimada';