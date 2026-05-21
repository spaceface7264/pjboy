/**
 * ModeRegistry — maps activeModeId to enter/exit/update/win/lose hooks on Game3D.
 */
(function (global) {
    'use strict';

    const MODE_DEFS = {
        campaign: {
            id: 'campaign',
            gameMode: 'play',
            enter(g) {
                g._teardownSpecialModes();
                g.gameMode = 'play';
                g.activeModeId = 'campaign';
                g.run = g._newCampaignRun();
                g.mazeDifficulty = g.run.stage;
                g.clearMaze && g.clearMaze();
                g.createLabyrinth && g.createLabyrinth();
                g.setupPlayMode && g.setupPlayMode();
                g._beginCampaignLevel && g._beginCampaignLevel();
                g.setViewMode('fpv');
            },
            exit(g) { g._stopCampaignRun(); },
            checkWin(g) {
                if (g._campaignExitReached) return 'level_complete';
                if (g.run && g.run.stage >= 10 && g._campaignExitReached) return 'campaign_complete';
                return null;
            },
            checkLose(g) {
                if (g.run && g.run.lives <= 0) return 'out_of_lives';
                return null;
            }
        },
        wide_halls: {
            id: 'wide_halls',
            gameMode: 'play',
            enter(g) {
                g._teardownSpecialModes && g._teardownSpecialModes();
                g.gameMode = 'play';
                g.activeModeId = 'wide_halls';
                const idx = g.savedMazes.findIndex((m) => m.type === 'generated');
                if (idx >= 0) g.currentMazeIndex = idx;
                g.run = { lives: 3, startTime: performance.now() };
                g.score = 0;
                g.kills = 0;
                g._wideHallsExitReached = false;
                g.clearMaze && g.clearMaze();
                g.createLabyrinth && g.createLabyrinth();
                g.setupPlayMode && g.setupPlayMode();
                g._spawnWideHallsPlayer && g._spawnWideHallsPlayer();
                g.setViewMode && g.setViewMode('fpv');
            },
            exit(g) {
                g._wideHallsExitReached = false;
                g.clearEnemies && g.clearEnemies();
                g.clearMaze && g.clearMaze();
            },
            checkWin(g) {
                return g._wideHallsExitReached ? 'halls_cleared' : null;
            },
            checkLose(g) {
                return (g.run && g.run.lives <= 0) ? 'out_of_lives' : null;
            }
        },
        arena: {
            id: 'arena',
            gameMode: 'play',
            enter(g) {
                g.activeModeId = 'arena';
                g.run = { score: 0, kills: 0, startTime: performance.now() };
                g.startArenaMode && g.startArenaMode();
            },
            exit(g) {
                if (g.arena && g.arena.active) {
                    g.arena.active = false;
                    g.arena.phase = 'idle';
                    g._clearArenaObjects && g._clearArenaObjects();
                    g.clearEnemies && g.clearEnemies();
                }
            }
        },
        explorer: {
            id: 'explorer',
            gameMode: 'play',
            enter(g) {
                g.activeModeId = 'explorer';
                g.run = { objectivesDone: 0 };
                g.enterOpenWorld && g.enterOpenWorld();
            },
            exit(g) {
                if (g.openWorld && g.openWorld.active) g.exitOpenWorld && g.exitOpenWorld();
            }
        },
        creator: {
            id: 'creator',
            gameMode: 'creator',
            enter(g) {
                g._teardownSpecialModes();
                g.activeModeId = 'creator';
                g.run = {};
                g.enterCreatorMode && g.enterCreatorMode();
            },
            exit(g) {
                g.exitCreatorMode && g.exitCreatorMode();
            }
        }
    };

    class ModeRegistry {
        constructor(game) {
            this.game = game;
            this.defs = MODE_DEFS;
        }

        activate(modeId) {
            const g = this.game;
            const prev = g.activeModeId;
            if (prev && this.defs[prev]) this.defs[prev].exit(g);
            const def = this.defs[modeId];
            if (!def) {
                console.warn('[ModeRegistry] unknown mode', modeId);
                return false;
            }
            def.enter(g);
            g.activeModeId = modeId;
            g.gameMode = def.gameMode;
            return true;
        }

        exitActive() {
            const g = this.game;
            const prev = g.activeModeId;
            if (prev && this.defs[prev]) this.defs[prev].exit(g);
            g.activeModeId = null;
        }

        checkWin() {
            const g = this.game;
            const def = g.activeModeId && this.defs[g.activeModeId];
            return def && def.checkWin ? def.checkWin(g) : null;
        }

        checkLose() {
            const g = this.game;
            const def = g.activeModeId && this.defs[g.activeModeId];
            return def && def.checkLose ? def.checkLose(g) : null;
        }
    }

    global.ModeRegistry = ModeRegistry;
    global.PJBOY_MODE_DEFS = MODE_DEFS;
})(typeof window !== 'undefined' ? window : global);
