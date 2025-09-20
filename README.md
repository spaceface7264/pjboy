# PJBoy - 3D Second-Person Maze Game

A retro-styled 3D maze game built with Three.js featuring second-person perspective gameplay, multiple game modes, and a 128-bit aesthetic.

## 🎮 Features

### Core Gameplay
- **3D Second-Person Perspective**: Camera follows behind the player character
- **Multiple Maze Types**: Wide halls, classic small, open arena, spiral, labyrinth, and ASCII-generated mazes
- **Dual Game Modes**:
  - **Play Mode**: Navigate mazes, fight enemies, collect items
  - **Create Mode**: Build custom mazes with wall placement tools
- **Progressive Difficulty**: 10 difficulty levels with increasing challenge
- **Multi-language Support**: Danish and English

### Visual & Audio
- **128-bit Retro Aesthetic**: Neon colors, glitch effects, and retro styling
- **Multiple Themes**: Neon, Forest, Desert, Dungeon
- **Dynamic Lighting**: Real-time lighting and shadows
- **Particle Effects**: Jetpack particles, impact effects, and visual feedback

### Controls & Interface
- **Multiple Control Schemes**:
  - Mouse Character Control
  - Space Orbit Camera
  - Tank Controls
  - Mouse Follow
- **Interactive UI**: Settings modal, toolbox for create mode, inventory system
- **Real-time HUD**: Health, weapons, compass, crosshair, and status indicators

### Game Mechanics
- **Combat System**: Ranged and melee weapons with different damage types
- **Inventory Management**: Item collection, quickbar system, and item activation
- **Flag System**: Place and collect flags for objectives
- **Enemy AI**: Dynamic enemy spawning and behavior
- **Power-ups**: Various power-ups and weapon upgrades

## 🚀 Getting Started

### Prerequisites
- Modern web browser with WebGL support
- No additional software installation required

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/spaceface7264/pjboy.git
   cd pjboy
   ```

2. Open `index.html` in your web browser, or serve it using a local web server:
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx serve .
   
   # Using PHP
   php -S localhost:8000
   ```

3. Navigate to `http://localhost:8000` in your browser

## 🎯 How to Play

### Basic Controls
- **WASD**: Move character
- **Mouse**: Look around / Turn character (depending on control scheme)
- **Space**: Jump / Fly / Change camera angle
- **P**: Open settings
- **T**: Open toolbox (Create Mode)
- **I**: Open inventory
- **Q**: Place wall (Create Mode)
- **E**: Erase (Create Mode)
- **Shift**: Draw straight lines (Create Mode)

### Game Modes

#### Play Mode
- Navigate through the maze to reach objectives
- Fight enemies using ranged and melee weapons
- Collect power-ups and items
- Place flags to mark important locations
- Survive increasing difficulty levels

#### Create Mode
- Use the toolbox to select different tools
- Click on highlighted grid squares to place walls
- Set start and end points for your maze
- Switch between different maze types and themes

### Settings
- **Maze Selection**: Choose from 6 different maze types
- **Difficulty**: Adjust from level 1-10
- **View Mode**: Switch between Isometric and First Person views
- **Theme**: Select visual theme (Neon, Forest, Desert, Dungeon)
- **Language**: Toggle between Danish and English
- **Control Scheme**: Choose your preferred control method

## 🛠️ Technical Details

### Built With
- **Three.js**: 3D graphics rendering
- **WebGL**: Hardware-accelerated graphics
- **Vanilla JavaScript**: No external frameworks
- **HTML5 Canvas**: Game rendering surface
- **CSS3**: UI styling and animations

### File Structure
```
pjboy/
├── index.html          # Main HTML file
├── game.js            # Core game logic and 3D engine
├── style.css          # UI styling and animations
├── instructions.txt   # Development notes and features
├── 3dmodelpjboy.glb   # 3D character model
├── chatgpt_avatar.glb # Alternative character model
├── cube.glb           # Basic cube model
├── walker.gltf        # Walker model
├── walker.bin         # Walker model data
└── inmaze/            # Additional assets
```

### Key Classes
- `Game3D`: Main game class handling all game logic
- Maze generation algorithms for different maze types
- 3D model loading and animation system
- Collision detection and physics
- UI management and event handling

## 🎨 Customization

### Adding New Themes
1. Modify the `applyTheme()` method in `game.js`
2. Add theme-specific materials and lighting
3. Update the theme selection UI in `index.html`

### Creating New Mazes
1. Add maze generation logic to the `generateMaze()` method
2. Register the new maze in the `initializeSavedMazes()` method
3. Add UI buttons in the settings modal

### Adding New Weapons
1. Extend the weapons system in `initializeWeapons()`
2. Add weapon models and animations
3. Implement weapon-specific behavior in `attackWithWeapon()`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 Development Notes

### Current Features (Fayek)
- Stun enemies on hit (5 seconds)
- Progressive levels (1-10) with increasing difficulty
- Timer start/stop functionality
- Enemies become gradually stronger and more numerous
- Welcome and loading screens
- Movement, shooting, taking damage, starting, ending, collecting items, placing flags

### Planned Features
- Enhanced enemy AI
- More weapon types
- Sound effects and music
- Multiplayer support
- Level editor improvements
- Mobile device support

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Three.js community for the excellent 3D library
- Retro gaming inspiration for the 128-bit aesthetic
- Contributors and testers who helped improve the game

---

**Enjoy exploring the mazes and creating your own!** 🎮✨
