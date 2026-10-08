-- Política de fotos de avistamientos, también aplicada por
-- supabase-report-approval.sql. Si la instalación ya existe, usa la migración
-- de aprobación, que incluye esta política junto con las reglas de visibilidad.
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
