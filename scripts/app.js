(() => {

    "use strict";


    /* =========================================================
       AUDIO TRACKS

       ADD MUSIC HERE LATER.

       EXAMPLE:

       const AUDIO_TRACKS = [

           "audio/track-01.mp3",
           "audio/track-02.mp3",
           "audio/track-03.mp3"

       ];

       ========================================================= */


    const AUDIO_TRACKS = [

        // "audio/track-01.mp3",
        // "audio/track-02.mp3",
        // "audio/track-03.mp3"

    ];



    /* =========================================================
       ROTATING MATRIX TEXT
       ========================================================= */


    const ROTATING_LINES = [

        "Scientific model directory online...",

        "Calculating eigenstate trajectories...",

        "Probability field initialized...",

        "Observer state detected...",

        "Quantum boundary conditions stable...",

        "Field equations awaiting input...",

        "Reality layer responding...",

        "Causality remains negotiable...",

        "Simulation parameters unlocked...",

        "Wavefunction awaiting observation...",

        "The universe declined to provide documentation...",

        "Scientific models standing by..."

    ];



    /* =========================================================
       PRIDE COLORS
       ========================================================= */


    const PRIDE_COLORS = [

        "#ff4d5a",

        "#ff9a32",

        "#ffe45e",

        "#00d66b",

        "#32a8ff",

        "#9b5cff"

    ];



    /*
        Matrix rain is already 75% green.

        Green is intentionally removed from the 25%
        accent pool so the requested 75/25 balance
        stays visually obvious.
    */


    const PRIDE_RAIN_COLORS = [

        "#ff4d5a",

        "#ff9a32",

        "#ffe45e",

        "#32a8ff",

        "#9b5cff"

    ];



    /* =========================================================
       DOM
       ========================================================= */


    const body =
        document.body;


    const siteShell =
        document.getElementById(
            "site-shell"
        );


    const modelStage =
        document.getElementById(
            "model-stage"
        );


    const modelFrame =
        document.getElementById(
            "model-frame"
        );


    const homeButton =
        document.getElementById(
            "home-button"
        );


        const controlsToggle =
    document.getElementById(
        "controls-toggle"
    );


const globalControls =
    document.querySelector(
        ".global-controls"
    );


    const playButton =
        document.getElementById(
            "play-button"
        );


    const stopButton =
        document.getElementById(
            "stop-button"
        );


    const nextButton =
        document.getElementById(
            "next-button"
        );


    const volumeSlider =
        document.getElementById(
            "volume-slider"
        );


    const audio =
        document.getElementById(
            "site-audio"
        );


    const status =
        document.getElementById(
            "sr-status"
        );


    const textElement =
        document.getElementById(
            "matrix-text"
        );


    const rainCanvas =
        document.getElementById(
            "matrix-rain"
        );


    const effectsCanvas =
        document.getElementById(
            "effects-layer"
        );


    const modelButtons =
        document.querySelectorAll(
            ".model-button"
        );


    const reducedMotion =
        window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        );




        controlsToggle.addEventListener(
    "click",
    () => {

        const hidden =
            globalControls.classList.toggle(
                "controls-hidden"
            );


        controlsToggle.textContent =
            hidden
                ? "+"
                : "×";


        controlsToggle.title =
            hidden
                ? "Show controls"
                : "Hide controls";


        controlsToggle.setAttribute(
            "aria-label",
            hidden
                ? "Show controls"
                : "Hide controls"
        );

    }
);



    /* =========================================================
       MODEL VIEWER

       NO MODEL IDS.
       NO HASH ROUTING.
       NO MODEL DATABASE IN JAVASCRIPT.

       HTML owns the URLs.
       JavaScript simply opens them.
       ========================================================= */


    function openModel(
        modelURL,
        modelTitle
    ) {

        if (!modelURL) {

            return;

        }


        body.classList.add(
            "model-active"
        );


        siteShell.setAttribute(
            "aria-hidden",
            "true"
        );


        modelStage.hidden =
            false;


        modelFrame.src =
            modelURL;


        modelFrame.title =
            modelTitle
            ||
            "Scientific model";


        document.title =

            `${modelTitle || "Scientific Model"} // Mike Mathison Scientific Models`;


        status.textContent =

            `${modelTitle || "Scientific model"} opened.`;

    }



    function showHome() {

        body.classList.remove(
            "model-active"
        );


        siteShell.removeAttribute(
            "aria-hidden"
        );


        modelStage.hidden =
            true;


        /*
            Kill the old model completely.

            This releases animation / canvas / WebGL work
            running inside the iframe.

            The global audio player survives because it is
            outside the iframe.
        */


        modelFrame.src =
            "about:blank";


        modelFrame.title =
            "Scientific model";


        document.title =
            "Mike Mathison // Scientific Models";


        status.textContent =
            "Scientific model directory opened.";

    }



    modelButtons.forEach(
        (button) => {

            button.addEventListener(
                "click",
                () => {

                    const modelURL =
                        button.dataset.model;


                    const modelTitle =
                        button.dataset.title
                        ||
                        button.textContent.trim();


                    openModel(
                        modelURL,
                        modelTitle
                    );

                }
            );

        }
    );



    homeButton.addEventListener(
        "click",
        showHome
    );



    /* =========================================================
       AUDIO PLAYER
       ========================================================= */


    let currentTrackIndex =
        0;



    audio.volume =
        Number(
            volumeSlider.value
        );



    function hasAudio() {

        return (
            AUDIO_TRACKS.length > 0
        );

    }



    function updateAudioButtons() {

        const disabled =
            !hasAudio();


        playButton.disabled =
            disabled;


        stopButton.disabled =
            disabled;


        nextButton.disabled =
            disabled;


        const message =
            disabled

                ? "Add audio paths to AUDIO_TRACKS in scripts/app.js."

                : "";


        playButton.title =
            message;


        stopButton.title =
            message;


        nextButton.title =
            message;

    }



    function loadTrack(index) {

        if (!hasAudio()) {

            return false;

        }


        currentTrackIndex =

            (
                index
                +
                AUDIO_TRACKS.length
            )

            %

            AUDIO_TRACKS.length;


        const source =

            new URL(

                AUDIO_TRACKS[
                    currentTrackIndex
                ],

                window.location.href

            ).href;



        if (
            audio.src !== source
        ) {

            audio.src =
                source;


            audio.load();

        }


        return true;

    }



    async function playMusic() {

        if (
            !loadTrack(
                currentTrackIndex
            )
        ) {

            return;

        }


        try {

            await audio.play();


            status.textContent =
                "Music playing.";

        }
        catch (error) {

            console.warn(
                "Audio playback could not start:",
                error
            );

        }

    }



    function stopMusic() {

        audio.pause();


        audio.currentTime =
            0;


        status.textContent =
            "Music stopped.";

    }



    async function nextTrack(
        continuePlaying =
            !audio.paused
    ) {

        if (!hasAudio()) {

            return;

        }


        loadTrack(
            currentTrackIndex + 1
        );


        if (continuePlaying) {

            try {

                await audio.play();

            }
            catch (error) {

                console.warn(
                    "Next audio track could not start:",
                    error
                );

            }

        }


        status.textContent =
            "Next music track selected.";

    }



    playButton.addEventListener(
        "click",
        playMusic
    );


    stopButton.addEventListener(
        "click",
        stopMusic
    );


    nextButton.addEventListener(
        "click",
        () => nextTrack()
    );


    volumeSlider.addEventListener(
        "input",
        () => {

            audio.volume =
                Number(
                    volumeSlider.value
                );

        }
    );


    audio.addEventListener(
        "ended",
        () => nextTrack(true)
    );



    /* =========================================================
       ROTATING TERMINAL TEXT
       ========================================================= */


    let textLineIndex =
        0;


    let characterIndex =
        0;


    let deleting =
        false;


    let typingTimer =
        null;



    function typeText() {

        const fullText =

            ROTATING_LINES[
                textLineIndex
            ];


        if (deleting) {

            characterIndex =
                Math.max(
                    0,
                    characterIndex - 1
                );

        }
        else {

            characterIndex =
                Math.min(
                    fullText.length,
                    characterIndex + 1
                );

        }


        textElement.textContent =

            fullText.slice(
                0,
                characterIndex
            );


        let delay =
            deleting
                ? 28
                : 72;



        if (
            !deleting
            &&
            characterIndex ===
            fullText.length
        ) {

            deleting =
                true;


            delay =
                2400;

        }


        else if (
            deleting
            &&
            characterIndex === 0
        ) {

            deleting =
                false;


            textLineIndex =

                (
                    textLineIndex
                    +
                    1
                )

                %

                ROTATING_LINES.length;


            delay =
                420;

        }



        typingTimer =

            window.setTimeout(

                typeText,

                reducedMotion.matches

                    ? Math.max(
                        delay,
                        140
                    )

                    : delay

            );

    }



    function restartTyping() {

        window.clearTimeout(
            typingTimer
        );


        typeText();

    }



    if (
        reducedMotion.addEventListener
    ) {

        reducedMotion.addEventListener(
            "change",
            restartTyping
        );

    }
    else if (
        reducedMotion.addListener
    ) {

        reducedMotion.addListener(
            restartTyping
        );

    }



    /* =========================================================
       MATRIX RAIN

       75% GREEN
       25% PRIDE COLORS
       ========================================================= */


    const rainContext =
        rainCanvas.getContext(
            "2d",
            {
                alpha: true
            }
        );



    const rainCharacters =

        "アァカサタナハマヤャラワン"

        +

        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

        +

        "0123456789";



    const rainFontSize =
        16;


    let rainDrops =
        [];


    let previousRainFrame =
        0;



    function resizeRainCanvas() {

        const ratio =

            Math.min(

                window.devicePixelRatio
                ||
                1,

                2

            );


        rainCanvas.width =

            Math.floor(

                window.innerWidth
                *
                ratio

            );


        rainCanvas.height =

            Math.floor(

                window.innerHeight
                *
                ratio

            );


        rainCanvas.style.width =
            `${window.innerWidth}px`;


        rainCanvas.style.height =
            `${window.innerHeight}px`;


        rainContext.setTransform(

            ratio,
            0,
            0,
            ratio,
            0,
            0

        );


        const columns =

            Math.ceil(

                window.innerWidth
                /
                rainFontSize

            );


        rainDrops =

            Array.from(

                {
                    length:
                        columns
                },

                () =>

                    Math.floor(

                        Math.random()

                        *

                        (
                            window.innerHeight
                            /
                            rainFontSize
                        )

                    )

                    -

                    Math.floor(

                        Math.random()
                        *
                        60

                    )

            );

    }



    function chooseRainColor() {

        /*
            75 percent Matrix green.
        */


        if (
            Math.random() < 0.75
        ) {

            return "#00ff66";

        }


        /*
            25 percent Pride-spectrum accent.
        */


        return (

            PRIDE_RAIN_COLORS[

                Math.floor(

                    Math.random()

                    *

                    PRIDE_RAIN_COLORS.length

                )

            ]

        );

    }



    function drawRain(timestamp) {

        requestAnimationFrame(
            drawRain
        );


        if (
            body.classList.contains(
                "model-active"
            )
            ||
            document.hidden
        ) {

            return;

        }


        const interval =

            reducedMotion.matches
                ? 165
                : 85;


        if (
            timestamp
            -
            previousRainFrame
            <
            interval
        ) {

            return;

        }


        previousRainFrame =
            timestamp;



        /*
            Fade previous characters.
        */


        rainContext.fillStyle =
            "rgba(0, 3, 1, 0.18)";


        rainContext.fillRect(

            0,
            0,

            window.innerWidth,
            window.innerHeight

        );


        rainContext.font =

            `${rainFontSize}px "Courier New", monospace`;



        for (
            let column = 0;
            column < rainDrops.length;
            column++
        ) {

            const character =

                rainCharacters[

                    Math.floor(

                        Math.random()

                        *

                        rainCharacters.length

                    )

                ];


            const x =
                column
                *
                rainFontSize;


            const y =
                rainDrops[column]
                *
                rainFontSize;


            const color =
                chooseRainColor();


            rainContext.fillStyle =
                color;


            if (
                Math.random() > 0.986
            ) {

                rainContext.shadowColor =
                    color;


                rainContext.shadowBlur =
                    8;

            }
            else {

                rainContext.shadowBlur =
                    0;

            }


            rainContext.fillText(

                character,

                x,
                y

            );


            if (
                y >
                window.innerHeight
                &&
                Math.random() >
                0.975
            ) {

                rainDrops[column] =

                    -Math.floor(

                        Math.random()
                        *
                        40

                    );

            }
            else {

                rainDrops[column]++;

            }

        }


        rainContext.shadowBlur =
            0;

    }



    /* =========================================================
       PRIDE SPARKS + FUMES

       LANDING PAGE ONLY.
       ========================================================= */


    const effectsContext =
        effectsCanvas.getContext(
            "2d",
            {
                alpha: true
            }
        );


    const particles =
        [];


    let previousEffectsFrame =
        performance.now();


    let spawnAccumulator =
        0;



    function resizeEffectsCanvas() {

        const ratio =

            Math.min(

                window.devicePixelRatio
                ||
                1,

                2

            );


        effectsCanvas.width =

            Math.floor(

                window.innerWidth
                *
                ratio

            );


        effectsCanvas.height =

            Math.floor(

                window.innerHeight
                *
                ratio

            );


        effectsCanvas.style.width =
            `${window.innerWidth}px`;


        effectsCanvas.style.height =
            `${window.innerHeight}px`;


        effectsContext.setTransform(

            ratio,
            0,
            0,
            ratio,
            0,
            0

        );

    }



    function randomBorderPoint() {

        const elements =

            [
                ...document.querySelectorAll(
                    "[data-effect-border]"
                )
            ]

            .filter(
                (element) => {

                    const rectangle =
                        element.getBoundingClientRect();


                    return (

                        rectangle.bottom > 0

                        &&

                        rectangle.top <
                        window.innerHeight

                    );

                }
            );


        if (!elements.length) {

            return null;

        }


        const element =

            elements[

                Math.floor(

                    Math.random()

                    *

                    elements.length

                )

            ];


        const rectangle =
            element.getBoundingClientRect();


        const side =
            Math.floor(
                Math.random()
                *
                4
            );



        /* TOP */


        if (side === 0) {

            return {

                x:
                    rectangle.left
                    +
                    Math.random()
                    *
                    rectangle.width,

                y:
                    rectangle.top,

                nx: 0,

                ny: -1

            };

        }



        /* RIGHT */


        if (side === 1) {

            return {

                x:
                    rectangle.right,

                y:
                    rectangle.top
                    +
                    Math.random()
                    *
                    rectangle.height,

                nx: 1,

                ny: 0

            };

        }



        /* BOTTOM */


        if (side === 2) {

            return {

                x:
                    rectangle.left
                    +
                    Math.random()
                    *
                    rectangle.width,

                y:
                    rectangle.bottom,

                nx: 0,

                ny: 1

            };

        }



        /* LEFT */


        return {

            x:
                rectangle.left,

            y:
                rectangle.top
                +
                Math.random()
                *
                rectangle.height,

            nx: -1,

            ny: 0

        };

    }



    function spawnParticle() {

        const origin =
            randomBorderPoint();


        if (!origin) {

            return;

        }


        const isFume =
            Math.random() < 0.18;


        const tangentX =
            -origin.ny;


        const tangentY =
            origin.nx;


        const tangentVelocity =

            (
                Math.random()
                -
                0.5
            )

            *

            (
                isFume
                    ? 8
                    : 55
            );


        const outwardVelocity =

            isFume

                ?

                8
                +
                Math.random()
                *
                12

                :

                35
                +
                Math.random()
                *
                90;


        particles.push({

            kind:
                isFume
                    ? "fume"
                    : "spark",

            x:
                origin.x,

            y:
                origin.y,

            vx:

                origin.nx
                *
                outwardVelocity

                +

                tangentX
                *
                tangentVelocity,

            vy:

                origin.ny
                *
                outwardVelocity

                +

                tangentY
                *
                tangentVelocity

                -

                (
                    isFume
                        ? 9
                        : 0
                ),

            color:

                PRIDE_COLORS[

                    Math.floor(

                        Math.random()

                        *

                        PRIDE_COLORS.length

                    )

                ],

            life:
                0,

            maxLife:

                isFume

                    ?

                    1.7
                    +
                    Math.random()
                    *
                    1.4

                    :

                    0.35
                    +
                    Math.random()
                    *
                    0.55,

            size:

                isFume

                    ?

                    7
                    +
                    Math.random()
                    *
                    11

                    :

                    0.8
                    +
                    Math.random()
                    *
                    1.7

        });


        /*
            Hard ceiling keeps the effect lightweight.
        */


        if (
            particles.length > 70
        ) {

            particles.shift();

        }

    }



    function drawParticles(timestamp) {

        requestAnimationFrame(
            drawParticles
        );


        const delta =

            Math.min(

                (
                    timestamp
                    -
                    previousEffectsFrame
                )

                /

                1000,

                0.05

            );


        previousEffectsFrame =
            timestamp;


        effectsContext.clearRect(

            0,
            0,

            window.innerWidth,
            window.innerHeight

        );


        /*
            No decorative effects while a model is open.
        */


        if (
            body.classList.contains(
                "model-active"
            )
            ||
            reducedMotion.matches
            ||
            document.hidden
        ) {

            particles.length =
                0;


            return;

        }


        spawnAccumulator +=
            delta;


        const spawnEvery =
            0.10;


        while (
            spawnAccumulator >=
            spawnEvery
        ) {

            spawnAccumulator -=
                spawnEvery;


            if (
                Math.random() < 0.72
            ) {

                spawnParticle();

            }

        }



        for (
            let index =
                particles.length - 1;
            index >= 0;
            index--
        ) {

            const particle =
                particles[index];


            particle.life +=
                delta;


            if (
                particle.life >=
                particle.maxLife
            ) {

                particles.splice(
                    index,
                    1
                );


                continue;

            }


            particle.x +=

                particle.vx
                *
                delta;


            particle.y +=

                particle.vy
                *
                delta;


            particle.vx *=

                particle.kind ===
                "fume"

                    ? 0.985

                    : 0.975;


            particle.vy *=
                0.985;


            const progress =

                particle.life
                /
                particle.maxLife;


            const alpha =

                Math.max(
                    0,
                    1 - progress
                );


            effectsContext.save();


            effectsContext.globalAlpha =

                particle.kind ===
                "fume"

                    ?

                    alpha
                    *
                    0.14

                    :

                    alpha
                    *
                    0.9;


            effectsContext.shadowColor =
                particle.color;


            effectsContext.shadowBlur =

                particle.kind ===
                "fume"

                    ? 18

                    : 8;



            /* =============================================
               FUME
               ============================================= */


            if (
                particle.kind ===
                "fume"
            ) {

                const radius =

                    particle.size

                    *

                    (
                        1
                        +
                        progress
                        *
                        1.8
                    );


                const gradient =

                    effectsContext
                        .createRadialGradient(

                            particle.x,
                            particle.y,
                            0,

                            particle.x,
                            particle.y,
                            radius

                        );


                gradient.addColorStop(
                    0,
                    particle.color
                );


                gradient.addColorStop(
                    1,
                    "rgba(0, 0, 0, 0)"
                );


                effectsContext.fillStyle =
                    gradient;


                effectsContext.beginPath();


                effectsContext.arc(

                    particle.x,
                    particle.y,
                    radius,

                    0,
                    Math.PI * 2

                );


                effectsContext.fill();

            }



            /* =============================================
               SPARK
               ============================================= */


            else {

                effectsContext.strokeStyle =
                    particle.color;


                effectsContext.lineWidth =
                    particle.size;


                effectsContext.beginPath();


                effectsContext.moveTo(

                    particle.x,
                    particle.y

                );


                effectsContext.lineTo(

                    particle.x

                    -

                    particle.vx
                    *
                    0.028,

                    particle.y

                    -

                    particle.vy
                    *
                    0.028

                );


                effectsContext.stroke();

            }


            effectsContext.restore();

        }

    }



    /* =========================================================
       RESIZE
       ========================================================= */


    function resizeCanvases() {

        resizeRainCanvas();

        resizeEffectsCanvas();

    }



    window.addEventListener(
        "resize",
        resizeCanvases
    );



    /* =========================================================
       INITIALIZE
       ========================================================= */


    updateAudioButtons();


    resizeCanvases();


    showHome();


    typeText();


    requestAnimationFrame(
        drawRain
    );


    requestAnimationFrame(
        drawParticles
    );

})();