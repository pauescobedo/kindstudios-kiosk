/*
 * ÚNICO ARCHIVO QUE NECESITAS EDITAR.
 * Cambia los ajustes generales sin tocar app.js.
 * Las rutas y botones de PDF están en `pdf-config.json`.
 * Nota: esto es una app sin servidor; los códigos quedan visibles para quien
 * inspeccione los archivos. Para seguridad real, conecta una base de datos/API.
 */
window.APP_CONFIG = {
  appName: "Kind Studios",
  sessionMinutes: 2,
  scheduleRange: { start: "2026-09-04", end: "2027-06-18" },
  checklistRange: { start: "2026-09-04", end: "2027-06-18" },
  // Checklist de administración: solo se muestran los viernes incluidos aquí.
  checklists: {
    "2026-09-04": {}, "2026-09-11": {}, "2026-09-18": {}, "2026-09-25": {},
    "2026-10-02": {}, "2026-10-09": {}, "2026-10-16": {}, "2026-10-23": {}, "2026-10-30": {},
    "2026-11-06": {}, "2026-11-13": {}, "2026-11-20": {}, "2026-11-27": {},
    "2026-12-04": {}, "2026-12-11": {}, "2026-12-18": {}
  },
  checklistGroups: {
    teatroGroup3: { title: "Teatro Musical Grupo 3", time: "17:30 - 18:45", students: ["Berta Martínez", "Mia Ferre", "Elna Juan", "Mariona Pérez", "Cloe Martín", "Naomi Lores", "Elsa Sánchez", "Adrià López", "Gala Pellicer", "Leia Grau", "Alexandra Carreras", "Gala Gonzalez"] },
    teatroGroup4: { title: "Teatro Musical Grupo 4", time: "18:45 - 20:15", students: ["Mar Gutiérrez", "Júlia Gutiérrez", "Èlia Cabruja", "Alba Murié", "Ariadna Carreras", "Gala Ponce", "Noelia Fernández", "Aina Salmerón", "Maria Pérez", "Iratxe Maraver", "Lucía Taravilla", "Nicole Lica", "Elsa Cuenca", "Paula Gallegos"] },
    viceGroup: { title: "Vice Group", time: "", students: ["Uxía López", "Lucía Curzel", "Candela Blanco", "Júlia Moimeau", "Nivia Dotto"] }
  }
};
