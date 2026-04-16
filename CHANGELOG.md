# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-04-15

### Added

- Retro Diffusion agent skill (`retro-diffusion`) — pixel-art image generation, img2img, spritesheets, and advanced animation workflows (walk, idle, attack, jump) from reference images
- Model presets for `RD_PRO`, `RD_FAST`, `RD_PLUS`, and advanced animation styles
- Inference, reference-prep, experiment-matrix, and spritesheet-extraction scripts (PEP 723, runnable with `uv run`)

### Changed

- Skill count updated from 7 to 8

## [1.2.0] - 2026-04-12

### Added

- Phaser 4 game dev agent skill (`phaser4-gamedev`) — WebGL-first renderer, filters, lighting, shaders, SpriteGPULayer, TilemapGPULayer, and Phaser 3 → 4 migration guidance
- "How I'm Vibe Coding A Game For the Vibe Jam" tutorial video

### Changed

- Skill count updated from 6 to 7
- Video count updated from 2 to 3
- "2D Phaser architecture" section now notes Phaser 3 + Phaser 4 migration coverage

## [1.1.0] - 2026-04-04

### Added

- Beginner-friendly tutorial videos for 2D and 3D workflows
- Beginner-friendly video section in README and START-HERE

### Changed

- Moved agent skills from `.codex/` to `.agents/` directory
- Tightened value-prop bullets in README
- Minor path and wording fixes across project READMEs

## [1.0.0] - 2026-04-04

### Added

- 4 standalone game starter projects (Oak Woods, Tinyswords, Toonshooter, Forest Census)
- 1 bonus isometric sprite workflow repo
- 6 shared agent skills: phaser-gamedev, playwright-testing, threejs-builder, tinyswords-tilemap, threejs-capacitor-ios, fal-ai-image
- Dual skill layout for Claude Code (`.claude/skills/`) and agent-compatible (`.codex/skills/`)
- START-HERE.md quick-start guide
- Preview gallery in README

[1.3.0]: https://github.com/chongdashu/vibejam-starter-pack/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/chongdashu/vibejam-starter-pack/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/chongdashu/vibejam-starter-pack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/chongdashu/vibejam-starter-pack/releases/tag/v1.0.0
