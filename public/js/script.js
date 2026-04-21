let servicioSeleccionado = null;

// 1. Cargar servicios en el Menú Desplegable
async function cargarServicios() {
    try {
        const res = await fetch('/api/servicios');
        const servicios = await res.json();
        const selectServicio = document.getElementById('select-servicio');
        
        selectServicio.innerHTML = '<option value="" disabled selected>Elegí un servicio...</option>';
        
        servicios.forEach(s => {
            const option = document.createElement('option');
            option.value = s.id;
            option.textContent = `${s.nombre} - $${s.precio}`;
            selectServicio.appendChild(option);
        });

        selectServicio.addEventListener('change', (e) => {
            servicioSeleccionado = e.target.value;
        });

    } catch (error) {
        console.error("Error al cargar servicios:", error);
    }
}

// 2. Inicializar Flatpickr
const hoy = new Date();
// Quitamos la variable 'mañana' porque ya no la necesitamos para el minDate
const limiteDosSemanas = new Date(hoy);
limiteDosSemanas.setDate(hoy.getDate() + 14);

flatpickr("#fecha", {
    locale: "es",
    minDate: "today", // <--- CAMBIO CLAVE: Permite seleccionar el día actual
    maxDate: limiteDosSemanas,
    disable: [date => date.getDay() === 0], // Sigue bloqueando Domingos
    onChange: function(selectedDates, dateStr) {
        cargarHorariosDisponibles(dateStr);
    }
});
// 3. Cargar horarios dinámicos
async function cargarHorariosDisponibles(fechaElegida) {
    const selectHora = document.getElementById('select-hora');
    selectHora.disabled = true;
    selectHora.innerHTML = '<option>Cargando horarios...</option>';

    try {
        const res = await fetch(`/api/horarios-disponibles?fecha=${fechaElegida}`);
        const data = await res.json(); 

        selectHora.innerHTML = '<option value="">-- Seleccioná la hora --</option>';
        
        if (!data.horarios || data.horarios.length === 0) {
            selectHora.innerHTML = '<option value="">Sin turnos para este día</option>';
            return;
        }

        data.horarios.forEach(hora => {
            const option = document.createElement('option');
            option.value = hora;
            option.textContent = `${hora} hs`;
            selectHora.appendChild(option);
        });

        selectHora.disabled = false;
    } catch (error) {
        selectHora.innerHTML = '<option value="">Error al cargar horarios</option>';
    }
}

// 4. Confirmar Reserva y Enviar WhatsApp
document.getElementById('btn-confirmar').onclick = async () => {
    const nombre = document.getElementById('nombre').value;
    const telefono = document.getElementById('telefono').value;
    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('select-hora').value;
    const selectServicio = document.getElementById('select-servicio');
    
    // CORRECCIÓN: Sacamos el ID y el Nombre del servicio correctamente
    const servicioId = selectServicio.value; 
    const nombreServicio = selectServicio.options[selectServicio.selectedIndex].text;

    // Validaciones
    if (!servicioId) return alert("Por favor, seleccioná un servicio.");
    if (!nombre || !telefono || !fecha || !hora) return alert("Completá todos los campos.");

    const fechaHoraFull = `${fecha} ${hora}`;

    const data = { 
        nombre, 
        telefono, 
        fecha: fechaHoraFull, 
        servicio_id: servicioId // Usamos la variable que definimos arriba
    };

    try {
        const res = await fetch('/api/reservar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });

        const result = await res.json();
        
        if (result.success) {
            const options = { weekday: 'long', day: '2-digit', month: '2-digit' };
            const fechaLinda = new Date(fecha + "T12:00:00").toLocaleDateString('es-AR', options);
            const diaCapitalizado = fechaLinda.charAt(0).toUpperCase() + fechaLinda.slice(1);
            
            const nroBarberia = "5493454055943"; 
            const mensajeWsp = encodeURIComponent(
                `*¡TURNO RESERVADO EN KATANA!* ✂️\n\n` +
                `Hola, soy *${nombre}*.\n` +
                `Confirmé mi turno desde la web:\n\n` +
                `💈 *Servicio:* ${nombreServicio}\n` +
                `📅 *Fecha:* ${diaCapitalizado}\n` + 
                `⏰ *Hora:* ${hora} hs\n\n` +
                `¡Nos vemos pronto!`
            );
            
            alert("✅ ¡Turno guardado! Ahora te redirigimos a WhatsApp para confirmar.");
            
            // Abrimos WhatsApp
            window.location.href = `https://wa.me/${nroBarberia}?text=${mensajeWsp}`;            
            // RECOMENDACIÓN: No recargues instantáneamente, 
            // deja que el usuario vea que se abrió la otra pestaña.
            setTimeout(() => { window.location.reload(); }, 1500);
            
        } else {
            alert("❌ Error: " + result.error);
        }
    } catch (error) {
        alert("❌ Error de conexión al servidor");
    }
};

// 5. Menu Toggle y carga inicial
document.addEventListener('DOMContentLoaded', () => {
    cargarServicios();
    
    const menuBtn = document.querySelector('.menu-toggle');
    if(menuBtn) {
        menuBtn.addEventListener('click', () => {
            document.querySelector('.nav-links').classList.toggle('active');
        });
    }
});

// 6. Carrusel
const track = document.querySelector('.carousel-track');
const nextButton = document.querySelector('#nextBtn');
const prevButton = document.querySelector('#prevBtn');

if (track && nextButton && prevButton) {
    const slides = Array.from(track.children);
    let currentPos = 0;

    const updateCarousel = () => {
        const slideWidth = slides[0].getBoundingClientRect().width;
        track.style.transform = `translateX(-${currentPos * (slideWidth + 20)}px)`;
    };

    nextButton.addEventListener('click', () => {
        const itemsToShow = window.innerWidth > 768 ? 3 : 1;
        if (currentPos < slides.length - itemsToShow) {
            currentPos++;
        } else {
            currentPos = 0;
        }
        updateCarousel();
    });

    prevButton.addEventListener('click', () => {
        const itemsToShow = window.innerWidth > 768 ? 3 : 1;
        if (currentPos > 0) {
            currentPos--;
        } else {
            currentPos = slides.length - itemsToShow;
        }
        updateCarousel();
    });

    window.addEventListener('resize', updateCarousel);
}

// 7. Navbar Scroll
window.addEventListener('scroll', function() {
    const nav = document.querySelector('.navbar');
    if (nav) {
        window.scrollY > 50 ? nav.classList.add('scrolled') : nav.classList.remove('scrolled');
    }
});