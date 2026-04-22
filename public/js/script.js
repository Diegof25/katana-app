let servicioSeleccionado = null;
let barberoSeleccionado = null;
let calendario = null;

// 1. Cargar Barberos (Nueva función)
async function cargarBarberos() {
    try {
        const res = await fetch('/api/barberos');
        const barberos = await res.json();
        const selectBarbero = document.getElementById('select-barbero');
        
        selectBarbero.innerHTML = '<option value="" disabled selected>Seleccioná al barbero...</option>';
        
        barberos.forEach(b => {
            const option = document.createElement('option');
            option.value = b.id;
            option.dataset.whatsapp = b.telefono; // Guardamos su cel aquí
            option.textContent = b.nombre;
            selectBarbero.appendChild(option);
        });

        selectBarbero.addEventListener('change', async (e) => {
    barberoSeleccionado = e.target.value;
    
    // 1. Pedimos la configuración de este barbero específico
    const res = await fetch(`/api/config?barbero_id=${barberoSeleccionado}`);
    const config = await res.json();

    if (config.dias_laborales) {
        // Convertimos "1,2,3" en un array de números [1, 2, 3]
        const diasQueTrabaja = config.dias_laborales.split(',').map(Number);
        
        // Configuramos el calendario para que bloquee los días que NO están en esa lista
        calendario.set("disable", [
            function(date) {
                // date.getDay() devuelve 0 para domingo, 1 para lunes, etc.
                return !diasQueTrabaja.includes(date.getDay());
            }
        ]);
    }

    // Reseteamos lo demás
    document.getElementById('fecha').value = '';
    document.getElementById('select-hora').innerHTML = '<option value="">Seleccioná un día primero</option>';
    document.getElementById('select-hora').disabled = true;
});
    } catch (error) {
        console.error("Error al cargar barberos:", error);
    }
}

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
const limiteDosSemanas = new Date(hoy);
limiteDosSemanas.setDate(hoy.getDate() + 14);

calendario = flatpickr("#fecha", { // <--- ASIGNAMOS A LA VARIABLE
    locale: "es",
    minDate: "today",
    maxDate: limiteDosSemanas,
    // Dejamos el disable vacío al principio o con una regla general
    onChange: function(selectedDates, dateStr) {
        cargarHorariosDisponibles(dateStr);
    }
});
// 3. Cargar horarios dinámicos
async function cargarHorariosDisponibles(fechaElegida) {
    if (!barberoSeleccionado) {
        alert("Por favor, seleccioná un barbero primero.");
        document.getElementById('fecha').value = '';
        return;
    }

    const selectHora = document.getElementById('select-hora');
    selectHora.disabled = true;
    selectHora.innerHTML = '<option>Cargando...</option>';

    try {
        // Ahora enviamos fecha Y barbero_id al servidor
        const res = await fetch(`/api/horarios-disponibles?fecha=${fechaElegida}&barbero_id=${barberoSeleccionado}`);
        const data = await res.json(); 

        selectHora.innerHTML = '<option value="">-- Seleccioná la hora --</option>';
        
        if (!data.horarios || data.horarios.length === 0) {
            selectHora.innerHTML = '<option value="">Sin turnos con este barbero</option>';
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
        selectHora.innerHTML = '<option value="">Error al cargar</option>';
    }
}

// 4. Confirmar Reserva y Enviar WhatsApp
document.getElementById('btn-confirmar').onclick = async () => {
    const nombre = document.getElementById('nombre').value;
    const telefono = document.getElementById('telefono').value;
    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('select-hora').value;
    
    const selectServicio = document.getElementById('select-servicio');
    const selectBarbero = document.getElementById('select-barbero'); // <--- El nuevo selector
    
    // Validaciones de selección
    if (!selectBarbero || !selectBarbero.value) return alert("Por favor, seleccioná un barbero.");
    if (!selectServicio.value) return alert("Por favor, seleccioná un servicio.");
    if (!nombre || !telefono || !fecha || !hora) return alert("Completá todos los campos.");

    const servicioId = selectServicio.value; 
    const nombreServicio = selectServicio.options[selectServicio.selectedIndex].text;
    
    // Datos del barbero seleccionado
    const barberoId = selectBarbero.value;
    const nombreBarbero = selectBarbero.options[selectBarbero.selectedIndex].text;
    const nroBarbero = selectBarbero.options[selectBarbero.selectedIndex].dataset.whatsapp; // El nro viene de la DB

    const fechaHoraFull = `${fecha} ${hora}`;

    const data = { 
        nombre, 
        telefono, 
        fecha: fechaHoraFull, 
        servicio_id: servicioId,
        barbero_id: barberoId // <--- Enviamos el ID a la DB
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
            
            // Armamos el mensaje para el barbero específico
            const mensajeWsp = encodeURIComponent(
                `*¡TURNO RESERVADO CON ${nombreBarbero.toUpperCase()}!* ✂️\n\n` +
                `Hola, soy *${nombre}*.\n` +
                `Confirmé mi turno desde la web:\n\n` +
                `💈 *Servicio:* ${nombreServicio}\n` +
                `📅 *Fecha:* ${diaCapitalizado}\n` + 
                `⏰ *Hora:* ${hora} hs\n\n` +
                `¡Nos vemos pronto!`
            );
            
            alert(`✅ ¡Turno guardado con ${nombreBarbero}! Ahora te redirigimos a su WhatsApp.`);
            
            // Redirección al WhatsApp del barbero elegido
            window.location.href = `https://wa.me/${nroBarbero}?text=${mensajeWsp}`;             
            
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
    cargarBarberos();
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


// --- 1. FUNCIÓN PARA CAMBIAR ENTRE BARBEROS ---
function mostrarGaleria(nombreBarbero) {
    // Ocultar todas las galerías de barberos
    document.querySelectorAll('.galeria-barbero').forEach(gal => {
        gal.classList.add('galeria-oculta');
    });

    // Mostrar la seleccionada por ID
    const seleccionada = document.getElementById(`galeria-${nombreBarbero}`);
    if (seleccionada) {
        seleccionada.classList.remove('galeria-oculta');
        
        // Reiniciar la posición al primer slide cada vez que se cambia
        const track = seleccionada.querySelector('.carousel-track');
        if (track) {
            track.style.transform = 'translateX(0px)';
        }
    }

    // Actualizar el estado visual de los botones
    document.querySelectorAll('.btn-filter').forEach(btn => btn.classList.remove('active'));
    
    // El 'event' permite detectar qué botón disparó la función
    if (window.event && window.event.currentTarget) {
        window.event.currentTarget.classList.add('active');
    }
    
    // Notificamos al navegador que el contenido cambió para evitar errores de scroll
    window.dispatchEvent(new Event('resize'));
}

// --- 2. LÓGICA UNIVERSAL PARA LAS FLECHAS (GIRAR FOTOS) ---
document.addEventListener('click', (e) => {
    // Detectar si el clic fue en una flecha (prev o next)
    const btn = e.target.closest('.carousel-btn');
    if (!btn) return;

    // Encontrar el carrusel específico donde se hizo clic
    const container = btn.closest('.carousel-container');
    const track = container.querySelector('.carousel-track');
    const slides = Array.from(track.children);
    
    if (slides.length === 0) return;

    // Calcular el ancho de una imagen para saber cuánto desplazar
    const slideWidth = slides[0].getBoundingClientRect().width + 20; // Ancho + gap (20px)
    
    // Obtener la posición actual del transform
    let currentTransform = 0;
    const style = window.getComputedStyle(track);
    const matrix = new WebKitCSSMatrix(style.transform);
    currentTransform = matrix.m41; // Extrae el valor de X

    // Lógica de movimiento
    if (btn.classList.contains('next')) {
        // Límite máximo de scroll hacia la izquierda
        const maxScroll = -(track.scrollWidth - container.offsetWidth);
        
        if (currentTransform > maxScroll + 10) { // +10 de margen de error
            track.style.transform = `translateX(${currentTransform - slideWidth}px)`;
        } else {
            // Si llega al final, vuelve al inicio
            track.style.transform = `translateX(0px)`;
        }
    } else if (btn.classList.contains('prev')) {
        // No permitir scroll más allá del inicio
        if (currentTransform < -10) {
            track.style.transform = `translateX(${currentTransform + slideWidth}px)`;
        }
    }
});


document.querySelectorAll('.carousel-slide').forEach(item => {
    item.addEventListener('click', function() {
        const video = this.querySelector('video');
        if (video) {
            if (video.paused) {
                // Pausar todos los demás videos antes de arrancar este (opcional)
                document.querySelectorAll('video').forEach(v => v.pause());
                
                video.play();
                this.classList.add('playing'); // Para esconder el icono de play
            } else {
                video.pause();
                this.classList.remove('playing');
            }
        }
    });
});