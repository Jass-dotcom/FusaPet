-- Flujo de aprobación para reportes publicados por usuarios normales.
-- Ejecutar una vez en Supabase SQL Editor en instalaciones ya existentes.
ALTER TABLE public.reportes
  ADD COLUMN IF NOT EXISTS revision_estado text NOT NULL DEFAULT 'aprobado';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reportes_revision_estado_check'
      AND conrelid = 'public.reportes'::regclass
  ) THEN
    ALTER TABLE public.reportes
      ADD CONSTRAINT reportes_revision_estado_check
      CHECK (revision_estado IN ('pendiente','aprobado','rechazado'));
  END IF;
END $$;

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

DROP POLICY IF EXISTS p_reportes_select ON public.reportes;
CREATE POLICY p_reportes_select ON public.reportes FOR SELECT TO anon, authenticated
  USING ((moderado = false AND revision_estado = 'aprobado') OR usuario_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS p_mascotas_select ON public.mascotas;
CREATE POLICY p_mascotas_select ON public.mascotas FOR SELECT TO anon, authenticated USING (
  usuario_id = auth.uid() OR public.is_admin() OR EXISTS (
    SELECT 1 FROM public.reportes r WHERE r.mascota_id = mascotas.id
      AND r.moderado = false AND r.revision_estado = 'aprobado'
  )
);

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

DROP POLICY IF EXISTS p_fotos_reporte_select ON public.fotos_reporte;
CREATE POLICY p_fotos_reporte_select ON public.fotos_reporte FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reportes r WHERE r.id = reporte_id
      AND ((r.moderado = false AND r.revision_estado = 'aprobado') OR r.usuario_id = auth.uid() OR public.is_admin())
  ));

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

DROP POLICY IF EXISTS p_usuarios_select ON public.usuarios;
GRANT SELECT ON TABLE public.usuarios TO authenticated;
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

-- El mismo bucket privado guarda fotos de reportes y de avistamientos.
-- Solo se firman para lectura pública las fotos ligadas a reportes aprobados.
DROP POLICY IF EXISTS p_report_photos_public_read ON storage.objects;
DROP POLICY IF EXISTS p_report_photos_scoped_read ON storage.objects;
CREATE POLICY p_report_photos_scoped_read ON storage.objects FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'report-photos'
    AND EXISTS (
      SELECT 1 FROM public.fotos_reporte f
      JOIN public.reportes r ON r.id = f.reporte_id
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
