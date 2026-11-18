(function (Scratch) {
    if (!Scratch.extensions.unsandboxed) {
        alert('This extension requires unsandboxed mode to handle custom audio routing.');
        return;
    }

    class PolyphonicSoundExtension {
        constructor() {
            this.activeClonesSounds = new Map();
        }

        getInfo() {
            return {
                id: 'polyphonicSounds',
                name: 'Polyphonic & Clone Sounds',
                color1: '#ff6680',
                color2: '#e64d66',
                blocks: [
                    {
                        opcode: 'playSoundPolyWithOptions',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'play sound [SOUND] with volume [VOL]% and pitch [PITCH]',
                        arguments: {
                            SOUND: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'soundMenu'
                            },
                            VOL: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 100
                            },
                            PITCH: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 0
                            }
                        }
                    },
                    {
                        opcode: 'stopCloneSounds',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stop all sounds in this clone'
                    }
                ],
                menus: {
                    soundMenu: {
                        acceptReporters: true,
                        items: 'getSounds'
                    }
                }
            };
        }

        getSounds(args, util) {
            const target = util.target;
            if (!target || !target.sprite || !target.sprite.sounds || target.sprite.sounds.length === 0) {
                return [{ text: 'no sounds available', value: '' }];
            }
            return target.sprite.sounds.map(sound => ({
                text: sound.name,
                value: sound.name
            }));
        }

        playSoundPolyWithOptions(args, util) {
            const soundName = args.SOUND;
            const volumePercent = Math.max(0, Math.min(200, Number(args.VOL) || 0));
            const pitchValue = Number(args.PITCH) || 0;

            const target = util.target;
            if (!target) return;
            const cloneId = target.id;

            const soundEntry = target.sprite.sounds.find(s => s.name === soundName);
            if (!soundEntry) return;

            const audioEngine = Scratch.vm.runtime.audioEngine;
            if (!audioEngine) return;

            audioEngine.decodeSoundData(soundEntry.asset).then(audioBuffer => {
                const audioContext = audioEngine.audioContext;
                if (!audioContext) return;

                // Create source node for the sound buffer
                const sourceNode = audioContext.createBufferSource();
                sourceNode.buffer = audioBuffer;

                // Apply pitch/playback rate change 
                // Formula: 2^(semitones / 12) converts pitch semitones to Web Audio playback rate multiplier
                sourceNode.playbackRate.value = Math.pow(2, pitchValue / 12);

                // Create gain node for volume control (0.0 to 2.0 scale)
                const gainNode = audioContext.createGain();
                gainNode.gain.value = volumePercent / 100;

                // Connect nodes: Source -> Gain Node -> Audio Destination (Speakers)
                sourceNode.connect(gainNode);
                gainNode.connect(audioContext.destination);

                sourceNode.start(0);

                // Track the node under this specific clone ID
                if (!this.activeClonesSounds.has(cloneId)) {
                    this.activeClonesSounds.set(cloneId, []);
                }
                this.activeClonesSounds.get(cloneId).push(sourceNode);

                sourceNode.onended = () => {
                    const list = this.activeClonesSounds.get(cloneId);
                    if (list) {
                        const index = list.indexOf(sourceNode);
                        if (index > -1) list.splice(index, 1);
                    }
                };
            });
        }

        stopCloneSounds(args, util) {
            const cloneId = util.target.id;
            const list = this.activeClonesSounds.get(cloneId);
            
            if (list) {
                list.forEach(node => {
                    try { node.stop(); } catch (e) { /* already stopped */ }
                });
                this.activeClonesSounds.set(cloneId, []);
            }
        }
    }

    Scratch.extensions.register(new PolyphonicSoundExtension());
})(Scratch);