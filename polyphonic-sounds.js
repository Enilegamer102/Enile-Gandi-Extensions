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
                        text: 'play sound [SOUND] with volume [VOL]% pitch [PITCH] pan [PAN]',
                        arguments: {
                            SOUND: { type: Scratch.ArgumentType.STRING, menu: 'soundMenu' },
                            VOL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
                            PITCH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
                            PAN: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
                        }
                    },
                    {
                        opcode: 'playSoundPolyUntilDone',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'play sound [SOUND] until done with volume [VOL]% pitch [PITCH] pan [PAN]',
                        arguments: {
                            SOUND: { type: Scratch.ArgumentType.STRING, menu: 'soundMenu' },
                            VOL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
                            PITCH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
                            PAN: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
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

        // Safe menu handler to prevent blank tab/crashing bugs
        getSounds(args, util) {
            try {
                const target = (util && util.target) ? util.target : (Scratch.vm && Scratch.vm.editingTarget ? Scratch.vm.editingTarget : null);
                if (!target || !target.sprite || !target.sprite.sounds || target.sprite.sounds.length === 0) {
                    return [{ text: 'no sounds available', value: '' }];
                }
                return target.sprite.sounds.map(sound => ({
                    text: sound.name,
                    value: sound.name
                }));
            } catch (e) {
                return [{ text: 'no sounds available', value: '' }];
            }
        }

        playSoundPolyWithOptions(args, util) {
            this._startSound(args, util); // Fire and forget
        }

        playSoundPolyUntilDone(args, util) {
            // Returning a Promise makes Scratch wait until resolve() is called
            return new Promise((resolve) => {
                this._startSound(args, util, () => {
                    resolve();
                });
            });
        }

        _startSound(args, util, onEndedCallback) {
            const soundName = args.SOUND;
            const volumePercent = Math.max(0, Math.min(200, Number(args.VOL) || 0));
            const pitchValue = Number(args.PITCH) || 0;
            const panPercent = Math.max(-100, Math.min(100, Number(args.PAN) || 0));

            const target = util.target;
            if (!target) {
                if (onEndedCallback) onEndedCallback();
                return;
            }
            const cloneId = target.id;

            const soundEntry = target.sprite.sounds.find(s => s.name === soundName);
            if (!soundEntry) {
                if (onEndedCallback) onEndedCallback();
                return;
            }

            const audioEngine = Scratch.vm.runtime.audioEngine;
            if (!audioEngine) {
                if (onEndedCallback) onEndedCallback();
                return;
            }

            audioEngine.decodeSoundData(soundEntry.asset).then(audioBuffer => {
                const audioContext = audioEngine.audioContext;
                if (!audioContext) {
                    if (onEndedCallback) onEndedCallback();
                    return;
                }

                const sourceNode = audioContext.createBufferSource();
                sourceNode.buffer = audioBuffer;
                sourceNode.playbackRate.value = Math.pow(2, pitchValue / 12);

                const gainNode = audioContext.createGain();
                gainNode.gain.value = volumePercent / 100;

                const pannerNode = audioContext.createStereoPanner();
                pannerNode.pan.value = panPercent / 100;

                sourceNode.connect(gainNode);
                gainNode.connect(pannerNode);
                pannerNode.connect(audioContext.destination);

                sourceNode.start(0);

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
                    if (onEndedCallback) onEndedCallback();
                };
            }).catch(() => {
                if (onEndedCallback) onEndedCallback();
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
