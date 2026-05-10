## El problema

Los equipos ya trabajan con agentes de IA, pero cada agente suele vivir encerrado
en el contexto local de una persona. Las conversaciones, decisiones, avances y
bloqueos quedan repartidos entre asistentes individuales, chats, repos y mensajes
sueltos.

Eso hace que el trabajo siga dependiendo de la disponibilidad humana para
coordinar contexto. Si alguien no está, su conocimiento tampoco. Si un
agente necesita saber qué decidió otro integrante, qué cambió en otra parte del
proyecto o por dónde conviene seguir, normalmente tiene que adivinar, interrumpir
a alguien o trabajar con información incompleta.

## La propuesta

Omni es una red de agentes de IA para equipos. Cada integrante trabaja con su
asistente local, y Omni conecta todos esos asistentes: guarda conversaciones,
decisiones y avances de cada uno, y los hace accesibles para cualquier persona o
agente del equipo en tiempo real.

Si alguien no está disponible, su agente lo está. El contexto que antes quedaba
encerrado en sesiones individuales pasa a formar parte de una memoria compartida
del proyecto, consultable por otros agentes cuando necesitan entender qué pasó,
qué se decidió o qué falta hacer.

## Cómo funciona

1. Cada integrante trabaja con su propio asistente local.
2. Omni captura actividad relevante: conversaciones, decisiones, archivos,
   avances, bloqueos y tareas.
3. Esa actividad se transforma en memoria compartida del equipo.
4. Los agentes pueden consultar esa memoria en tiempo real cuando necesitan
   contexto de otra persona o del proyecto completo.
5. Con esa información, Omni organiza responsabilidades, propone tareas,
   reconstruye avances y muestra cómo se conecta el trabajo del equipo.

## Qué permite

- Consultar el contexto de otro integrante sin interrumpirlo.
- Saber en qué quedó una tarea o decisión.
- Entender qué cambió en el proyecto y quién lo trabajó.
- Mantener una memoria viva del equipo, no solo historiales aislados.
- Proponer tareas que no se pisan entre sí.
- Visualizar responsabilidades, avances y relaciones entre agentes, personas y
  documentos.

## Componentes principales

### Memoria compartida entre agentes

Omni conecta los asistentes locales de cada integrante y convierte su actividad
en contexto reutilizable. Un agente puede pedir memoria del proyecto o de otra
persona para responder mejor sin romper el flujo de trabajo.

### Tablero de responsabilidades

Con la información compartida, Omni genera un tablero de responsabilidades por
usuario. Cada integrante tiene una descripción viva de su rol, su área de
ownership, su estado reciente y sus posibles bloqueos.

### Propuesta de tareas

Omni puede sugerir nuevas tareas usando la memoria del proyecto: actividad
reciente, responsabilidades, bloqueos y cosas que quedaron abiertas. La idea es
ayudar a repartir trabajo sin duplicar esfuerzos ni pisarse entre integrantes.

### Línea de tiempo de avances

La línea de tiempo reconstruye qué pasó durante el proyecto, quién avanzó en qué
y cuándo ocurrieron los cambios importantes. Sirve para entender el estado del
equipo sin depender de reportes manuales.

### Grafo del trabajo del equipo

El grafo muestra cómo se conectan personas, agentes, documentos, eventos, tareas
y consultas de contexto. Ayuda a ver no solo qué información existe, sino también
cómo circula dentro del equipo.

Construido durante Platanus Hack 2026 en 36 horas.
