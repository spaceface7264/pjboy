/**
 * Translation System - Multi-language support
 */
export const translations = {
    danish: {
        // Game modes
        playMode: 'Spil Tilstand',
        createMode: 'Bygge Tilstand',
        
        // Actions
        start: 'Start',
        resume: 'Genoptag',
        pause: 'Pause',
        restart: 'Genstart',
        exit: 'Afslut',
        settings: 'Indstillinger',
        back: 'Tilbage',
        save: 'Gem',
        load: 'Indlæs',
        
        // Game states
        menu: 'Menu',
        playing: 'Spiller',
        paused: 'Pauseret',
        gameOver: 'Spil Slut',
        victory: 'Sejr!',
        
        // Maze selection
        mazeSelection: 'Labyrint Valg',
        labyrinth: 'Labyrint',
        wideHalls: 'Brede Gange',
        classicSmall: 'Klassisk Lille',
        squareGrid: 'Kvadrat Gitter',
        spiral: 'Spiral',
        asciiMaze: 'ASCII Labyrint',
        custom: 'Brugerdefineret',
        
        // Descriptions
        labyrinthDesc: 'Statisk 61x61 hæk labyrint med brede korridorer og blindgyder',
        wideHallsDesc: 'Stor labyrint med brede 5-celle gange',
        classicSmallDesc: 'Lille klassisk labyrint',
        squareGridDesc: 'Enkelt kvadrat gitter mønster',
        spiralDesc: 'Spiral labyrint mønster',
        asciiMazeDesc: 'Genereret ASCII perfekt labyrint (sværhedsgrad-drevet)',
        customDesc: 'Byg din egen labyrint',
        
        // Game elements
        health: 'Helbred',
        score: 'Point',
        level: 'Niveau',
        time: 'Tid',
        lives: 'Liv',
        
        // Controls
        move: 'Bevæg',
        shoot: 'Skyd',
        interact: 'Interager',
        jump: 'Hop',
        
        // Settings
        language: 'Sprog',
        volume: 'Lydstyrke',
        graphics: 'Grafik',
        controls: 'Kontroller'
    },
    
    english: {
        // Game modes
        playMode: 'Play Mode',
        createMode: 'Create Mode',
        
        // Actions
        start: 'Start',
        resume: 'Resume',
        pause: 'Pause',
        restart: 'Restart',
        exit: 'Exit',
        settings: 'Settings',
        back: 'Back',
        save: 'Save',
        load: 'Load',
        
        // Game states
        menu: 'Menu',
        playing: 'Playing',
        paused: 'Paused',
        gameOver: 'Game Over',
        victory: 'Victory!',
        
        // Maze selection
        mazeSelection: 'Maze Selection',
        labyrinth: 'Labyrinth',
        wideHalls: 'Wide Halls',
        classicSmall: 'Classic Small',
        squareGrid: 'Square Grid',
        spiral: 'Spiral',
        asciiMaze: 'ASCII Maze',
        custom: 'Custom',
        
        // Descriptions
        labyrinthDesc: 'Static 61x61 hedge maze with wide corridors and dead ends',
        wideHallsDesc: 'Large maze with wide 5-cell halls',
        classicSmallDesc: 'Small classic maze',
        squareGridDesc: 'Simple square grid pattern',
        spiralDesc: 'Spiral maze pattern',
        asciiMazeDesc: 'Generated ASCII perfect maze (difficulty-driven)',
        customDesc: 'Build your own maze',
        
        // Game elements
        health: 'Health',
        score: 'Score',
        level: 'Level',
        time: 'Time',
        lives: 'Lives',
        
        // Controls
        move: 'Move',
        shoot: 'Shoot',
        interact: 'Interact',
        jump: 'Jump',
        
        // Settings
        language: 'Language',
        volume: 'Volume',
        graphics: 'Graphics',
        controls: 'Controls'
    }
};

export const defaultLanguage = 'danish';
