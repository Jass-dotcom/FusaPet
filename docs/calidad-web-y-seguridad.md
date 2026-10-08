# Calidad web y seguridad de FusaPet

Este proyecto es una aplicación de una sola página. `index.html` contiene metadatos compartidos y JSON-LD de organización; las pantallas se montan desde `src/js/app.js`.

## Rendimiento y experiencia

- Los scripts principales usan `defer`; el mapa carga Leaflet, MapLibre y sus estilos solo cuando la persona solicita usarlo.
- Las fotografías del reporte se reducen a 1.600 px y se convierten a WebP en el dispositivo cuando el navegador lo admite; se descarta metadata EXIF. En pantalla usan `loading="lazy"`, `decoding="async"`, texto alternativo y dimensiones reservadas. No hay imágenes de héroe en la interfaz actual.
- Los contenedores de mapa y fotos reservan espacio para reducir cambios de diseño. La interfaz usa fuentes del sistema; no descarga fuentes web.
- El uso real de LCP, INP y CLS depende del dispositivo, la red y el alojamiento. Los valores objetivo deben medirse en producción con datos de usuarios y Lighthouse.

## Accesibilidad

- Las vistas tienen un enlace para saltar al contenido principal, etiquetas asociadas a campos, navegación identificada y estilos de foco visibles.
- Los diálogos y modales limitan el foco al contenido, admiten Escape y devuelven el foco al control que los abrió.
- Los controles de icono tienen nombres accesibles y área de interacción ampliada; el mapa tiene una lista de reportes que sigue disponible sin cargar recursos de mapa.
- El color del texto secundario se oscureció para alcanzar contraste AA sobre superficies claras. Revisa también estados y colores en los CSS de cada componente al modificar la paleta.

## Seguridad, privacidad y despliegue

- Las consultas de datos usan Supabase/PostgREST parametrizado. El término de búsqueda se restringe a texto sencillo antes de crear el filtro OR; los valores dinámicos renderizados se escapan y los mensajes al usuario se escriben como texto.
- La sesión de Supabase usa credenciales bearer del cliente, no cookies de sesión propias; las políticas RLS y las validaciones de base de datos siguen siendo la autorización efectiva. Nunca publiques una clave `service_role` en el navegador.
- Las fotos tienen límites de tipo y tamaño en cliente y en Supabase Storage. La validación cliente solo mejora la experiencia: el servidor sigue siendo la autoridad.
- Los recursos del mapa y las solicitudes de teselas externas esperan consentimiento; la elección aceptada se guarda como preferencia funcional en `localStorage`. Sin mapa, la dirección escrita basta para publicar un reporte.
- `_headers` define CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y protección contra marcos para Netlify y Cloudflare Pages. Confirma que el proveedor de producción aplique este formato; de lo contrario copia los mismos encabezados a la configuración del proxy/servidor. HSTS requiere HTTPS. Mantén la CSP sincronizada con el dominio Supabase y los proveedores de mapas usados.
- La política permite estilos en línea porque la interfaz actual usa atributos `style` y Leaflet los necesita. No habilita JavaScript en línea. Quitar `unsafe-inline` de estilos requiere migrar esos estilos primero.
- El flujo de navegador no mantiene un formulario de sesión propio con cookies, por lo que CSRF se reduce al uso de bearer tokens y políticas de origen/RLS de Supabase. Revisa además las políticas CORS y RLS del proyecto Supabase al desplegar.

## SEO y contenido

- Se añadió información Open Graph y Schema.org `Organization` sin inventar dirección, teléfono ni URL pública.
- La aplicación debe desplegarse con un dominio canónico para añadir `canonical`, URL de JSON-LD y sitemap. El contenido se genera en cliente, por lo que el SEO de páginas individuales requiere renderizado/prerenderizado si se busca indexación profunda.
- Conserva un solo `<h1>` por vista y no subas niveles de encabezado al ampliar las pantallas.
