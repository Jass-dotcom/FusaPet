# Calidad del sistema: plan de pruebas

## Alcance y estado

Esta sección propone pruebas para las funciones que existen actualmente en FusaPet. La aplicación está construida con JavaScript en el navegador y utiliza Supabase para autenticación, base de datos y controles de acceso. Por ello, los casos de este documento se refieren a las funciones `AuthService`, el enrutador de la aplicación, el panel de administración y las políticas/RPC definidas en `supabase-setup.sql`.

**Estado:** casos propuestos; todavía no se han ejecutado. No hay resultados ni capturas de consola disponibles. Las figuras de evidencia deberán añadirse después de ejecutar los casos y guardar sus resultados. Este documento no presenta como realizadas las pruebas que están pendientes.

## 1.1 Módulo de autenticación y control de acceso

El módulo delega el inicio de sesión, el registro, el cierre de sesión y la recuperación de contraseña a Supabase Auth. La aplicación mantiene el usuario de la sesión, obtiene su perfil con la función `get_my_profile` y verifica el estado activo y el rol antes de permitir ciertas rutas.

### Prueba propuesta 1: inicio de sesión con credenciales válidas

Con una cuenta de prueba activa existente en Supabase, iniciar sesión con el correo y la contraseña correctos. Se espera que `AuthService.login` complete sin error, conserve el usuario autenticado y que la aplicación navegue al panel principal. La sesión y sus tokens son gestionados por Supabase Auth.

Es importante porque la autenticación permite acceder a las funciones protegidas de la plataforma. La prueba debe realizarse con una cuenta de ensayo y sin publicar sus credenciales ni sus tokens en las evidencias.

**Evidencia pendiente:** captura de la ejecución y comprobación de la sesión/página de destino, con datos sensibles ocultos.

### Prueba propuesta 2: rechazo de credenciales inválidas

Intentar iniciar sesión con una contraseña incorrecta y, por separado, con un correo no registrado. Se espera que ambos intentos sean rechazados por Supabase y que el formulario muestre un error sin iniciar sesión. La interfaz traduce el error de credenciales inválidas de Supabase al mensaje «Correo o contraseña incorrectos».

Este caso comprueba el camino de error del inicio de sesión y evita que una autenticación fallida permita acceder a páginas protegidas.

**Evidencia pendiente:** captura de ambos intentos fallidos, sin incluir contraseñas.

### Prueba propuesta 3: registro y confirmación de correo

Registrar una cuenta de prueba con datos válidos y verificar el flujo configurado en Supabase. Si Supabase exige confirmar el correo, la aplicación debe informar «Revisa tu correo para confirmar tu cuenta»; si devuelve una sesión inmediatamente, debe informar que la cuenta fue creada y continuar al panel.

Este caso valida que la interfaz respete las dos respuestas posibles del proveedor según la configuración de confirmación de correo.

**Evidencia pendiente:** captura del resultado y, si aplica, del correo de confirmación con la dirección parcialmente ocultada.

### Prueba propuesta 4: acceso de una cuenta inactiva

Iniciar una sesión con una cuenta cuyo perfil en `usuarios` tenga `activo = false` y abrir una ruta protegida. El enrutador comprueba el perfil, cierra la sesión y muestra el aviso «Tu cuenta está desactivada. Contacta al administrador.»; la cuenta no debe permanecer en el panel.

Este control reduce el riesgo de que una cuenta desactivada continúe operando con una sesión anterior.

**Evidencia pendiente:** captura del aviso y comprobación de que la sesión haya sido cerrada.

### Prueba propuesta 5: acceso al panel administrativo por rol

Intentar abrir `#admin` con una cuenta de rol `usuario` y luego con una cuenta de rol `administrador`. La primera debe recibir «Acceso denegado» y volver al panel principal; la segunda debe ver el panel de administración.

La interfaz aplica esta validación en el enrutador. Además, las operaciones administrativas deben quedar protegidas en el servidor mediante RLS y las funciones RPC; ocultar una ruta en la interfaz, por sí solo, no es una medida de seguridad suficiente.

**Evidencia pendiente:** capturas de los dos casos y verificación de permisos del lado de Supabase.

## 1.2 Módulo de administración

El panel existente permite consultar usuarios, revisar denuncias, administrar comunas y consultar estadísticas. El acceso administrativo se valida con el perfil y algunas operaciones se protegen en Supabase mediante las funciones `admin_list_users` y `admin_moderate_flag`, políticas RLS y disparadores.

### Prueba propuesta 1: carga de usuarios en el panel

Abrir la pestaña «Usuarios» con una cuenta administradora. Se espera que la aplicación invoque `admin_list_users` y muestre los usuarios devueltos con nombre, correo, rol y estado. Ejecutar también la solicitud con una cuenta no administradora y verificar que Supabase la rechace con «Acceso denegado».

Este caso comprueba tanto la carga de datos que necesita la vista como la autorización del lado del servidor.

**Evidencia pendiente:** captura del panel con datos ficticios o anonimizados y resultado del intento no autorizado.

### Prueba propuesta 2: protección de cambios de rol y estado

Con una cuenta administradora, cambiar el rol o estado de un usuario de prueba y comprobar que el cambio se refleje en el perfil. Repetir la actualización con un usuario normal y verificar que el servidor la rechace. La función de protección `protect_user_role` impide que una cuenta no administradora cambie campos protegidos.

Este caso protege la asignación de privilegios y permite comprobar el bloqueo de cuentas desde la administración.

**Evidencia pendiente:** capturas del cambio autorizado y del intento rechazado.

### Prueba propuesta 3: moderación de una denuncia

Con una cuenta administradora, marcar una denuncia como aprobada y verificar que la función `admin_moderate_flag` actualice el estado de la denuncia y marque el reporte relacionado como moderado. Después, desestimar la denuncia y comprobar el estado resultante. Con una cuenta no administradora, intentar invocar la RPC y verificar el rechazo.

Este caso valida el flujo de moderación y que una cuenta normal no pueda retirar publicaciones alterando directamente el estado.

**Evidencia pendiente:** captura de la denuncia antes y después, y del intento no autorizado.

### Prueba propuesta 4: estadísticas administrativas

Abrir la pestaña «Estadísticas» y comparar los totales presentados con los registros de prueba de usuarios, reportes publicados y recuperados, mascotas y denuncias pendientes. Se espera que los valores del panel coincidan con los datos consultados.

Este caso ayuda a detectar errores en los conteos mostrados al administrador.

**Evidencia pendiente:** captura de los conteos y de la consulta usada para contrastarlos.

## 1.3 Rendimiento y evidencia

El proyecto revisado no incluye una API propia ejecutada en Docker ni una base PostgreSQL local declarada en el repositorio; utiliza el servicio Supabase configurado en `src/js/app.js`. Por esa razón, no se atribuyen aquí tiempos de respuesta ni se afirma que exista una prueba de rendimiento de menos de 300 ms.

Si el requisito del proyecto incluye rendimiento, deberá definirse qué operaciones medir, el entorno y los datos de prueba, y ejecutar mediciones contra el proyecto Supabase correspondiente. Los resultados deben documentar fecha, entorno, número de repeticiones y promedio o percentiles. Hasta entonces, el rendimiento queda **pendiente de medición**.

Para completar la evidencia de este capítulo, cada captura debe mostrar el nombre del caso y su resultado; se deben ocultar correos personales, contraseñas, claves, tokens y otros datos sensibles. Una vez ejecutadas las pruebas, actualizar este documento con el resultado real (aprobado/fallido), el entorno y las incidencias encontradas.
