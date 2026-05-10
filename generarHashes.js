const bcrypt = require('bcrypt');

const usuarios = [
    { nombre: 'Walter', clave: 'walter123' },
    { nombre: 'Valen', clave: 'valen123' },
    { nombre: 'Nacho', clave: 'nacho123' },
    { nombre: 'Luciano', clave: 'luciano123' }
];

async function hashear() {
    console.log("--- COPIA ESTOS VALORES A TU BASE DE DATOS ---");
    for (let u of usuarios) {
        const hash = await bcrypt.hash(u.clave, 10);
        console.log(`${u.nombre}: ${hash}`);
    }
}

hashear();