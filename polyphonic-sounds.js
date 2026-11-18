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
                iconURI: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="white" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
                blocks: [
                    {
                        blockType: Scratch.BlockType.LABEL,
                        text: 'Polyphonic Audio Playback'
                    },
                    {
                        opcode: 'playSoundPolyWithOptions',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'play sound [SOUND] with volume [VOL]% pitch [PITCH] pan [PAN]',
                        arguments: {
                            // Using native Scratch sound argument type fixes dropdown loading bugs
                            SOUND: { type: Scratch.ArgumentType.SOUND },
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
                            SOUND: { type: Scratch.ArgumentType.SOUND },
                            VOL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
                            PITCH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
                            PAN: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
                        }
                    },
                    {
                        blockType: Scratch.BlockType.LABEL,
                        text: 'Clone Sound Management'
                    },
                    {
                        opcode: 'stopCloneSounds',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stop all sounds in this clone'
                    }
                ]
            };
        }

        playSoundPolyWithOptions(args, util) {
            this._startSound(args, util);
        }

        playSoundPolyUntilDone(args, util) {
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
