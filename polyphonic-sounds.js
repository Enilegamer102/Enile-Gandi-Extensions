class Extension {
    constructor(runtime) {
        this.runtime = runtime;
        this.activeSounds = new Map();   // target.id -> Set of { source, finish }
        this.bufferCache = new Map();    // assetId -> Promise<AudioBuffer>

        // Stop everything when the red stop button is pressed
        if (runtime && runtime.on) {
            runtime.on('PROJECT_STOP_ALL', () => this._stopAll());
            // Clean up when a clone is deleted
            runtime.on('targetWasRemoved', (target) => {
                if (target) this._stopTarget(target.id);
            });
        }
    }

    getInfo() {
        return {
            id: 'polyphonicSounds',
            name: 'Polyphonic & Clone Sounds',
            color1: '#ff6680',
            color2: '#e64d66',
            blocks: [
                {
                    blockType: 'label',
                    text: 'Polyphonic Audio Playback'
                },
                {
                    opcode: 'playSoundPolyWithOptions',
                    blockType: 'command',
                    text: 'play sound [SOUND] with volume [VOL]% pitch [PITCH] pan [PAN]',
                    arguments: {
                        SOUND: { type: 'string', menu: 'soundsMenu' },
                        VOL: { type: 'number', defaultValue: 100 },
                        PITCH: { type: 'number', defaultValue: 0 },
                        PAN: { type: 'number', defaultValue: 0 }
                    }
                },
                {
                    opcode: 'playSoundPolyUntilDone',
                    blockType: 'command',
                    text: 'play sound [SOUND] until done with volume [VOL]% pitch [PITCH] pan [PAN]',
                    arguments: {
                        SOUND: { type: 'string', menu: 'soundsMenu' },
                        VOL: { type: 'number', defaultValue: 100 },
                        PITCH: { type: 'number', defaultValue: 0 },
                        PAN: { type: 'number', defaultValue: 0 }
                    }
                },
                {
                    blockType: 'label',
                    text: 'Clone Sound Management'
                },
                {
                    opcode: 'stopCloneSounds',
                    blockType: 'command',
                    text: 'stop all sounds in this clone'
                }
            ],
            menus: {
                soundsMenu: {
                    acceptReporters: true,
                    items: '_getSoundsMenu'
                }
            }
        };
    }

    /* ---------- Menu ---------- */

    _getSoundsMenu() {
        const target = this.runtime.getEditingTarget() || this.runtime.getTargetForStage();
        if (target && target.sprite && target.sprite.sounds && target.sprite.sounds.length > 0) {
            return target.sprite.sounds.map(s => ({ text: s.name, value: s.name }));
        }
        return [{ text: '', value: '' }];
    }

    /* ---------- Blocks ---------- */

    playSoundPolyWithOptions(args, util) {
        // Fire and forget – never throw back into the VM
        this._startSound(args, util).catch(() => {});
    }

    playSoundPolyUntilDone(args, util) {
        // Returning a promise makes the thread wait until it resolves
        return this._startSound(args, util).catch(() => {});
    }

    stopCloneSounds(args, util) {
        if (util.target) this._stopTarget(util.target.id);
    }

    /* ---------- Internals ---------- */

    _findSound(target, soundArg) {
        const sounds = target.sprite && target.sprite.sounds;
        if (!sounds || sounds.length === 0) return null;

        // Match by name first
        const byName = sounds.find(s => s.name === String(soundArg));
        if (byName) return byName;

        // Then by 1-based index (like the built-in sound blocks)
        const index = Number(soundArg);
        if (!isNaN(index) && index >= 1) {
            return sounds[Math.round(index) - 1] || null;
        }
        return null;
    }

    _getBuffer(target, soundEntry, audioContext) {
        // 1. Reuse the buffer the engine already decoded, if available
        try {
            const bank = target.sprite && target.sprite.soundBank;
            const player = bank && bank.soundPlayers && bank.soundPlayers[soundEntry.soundId];
            if (player && player.buffer) {
                return Promise.resolve(player.buffer);
            }
        } catch (e) { /* fall through */ }

        // 2. Otherwise decode the raw asset data ourselves (cached)
        const key = soundEntry.assetId || soundEntry.soundId || soundEntry.name;
        if (this.bufferCache.has(key)) return this.bufferCache.get(key);

        const asset = soundEntry.asset;
        if (!asset || !asset.data) {
            return Promise.reject(new Error('Sound has no asset data'));
        }
        const d = asset.data;
        // decodeAudioData detaches the buffer, so always hand it a copy
        const copy = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);

        const promise = new Promise((resolve, reject) => {
            // Callback form works on every browser
            audioContext.decodeAudioData(copy, resolve, reject);
        });
        this.bufferCache.set(key, promise);
        promise.catch(() => this.bufferCache.delete(key));
        return promise;
    }

    _startSound(args, util) {
        return new Promise((resolve) => {
            try {
                const target = util.target;
                const audioEngine = this.runtime.audioEngine;
                if (!target || !audioEngine || !audioEngine.audioContext) {
                    resolve();
                    return;
                }

                const soundEntry = this._findSound(target, args.SOUND);
                if (!soundEntry) {
                    resolve();
                    return;
                }

                const volume = Math.max(0, Math.min(200, Number(args.VOL) || 0)) / 100;
                const pitch = Number(args.PITCH) || 0;
                const pan = Math.max(-100, Math.min(100, Number(args.PAN) || 0)) / 100;

                const audioContext = audioEngine.audioContext;
                const cloneId = target.id;

                this._getBuffer(target, soundEntry, audioContext).then((buffer) => {
                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }

                    const source = audioContext.createBufferSource();
                    source.buffer = buffer;
                    source.playbackRate.value = Math.pow(2, pitch / 12);

                    const gain = audioContext.createGain();
                    gain.gain.value = volume;

                    const panner = audioContext.createStereoPanner();
                    panner.pan.value = pan;

                    source.connect(gain);
                    gain.connect(panner);
                    panner.connect(audioEngine.inputNode || audioContext.destination);

                    const entry = { source, finish: resolve };
                    if (!this.activeSounds.has(cloneId)) {
                        this.activeSounds.set(cloneId, new Set());
                    }
                    this.activeSounds.get(cloneId).add(entry);

                    source.onended = () => {
                        const set = this.activeSounds.get(cloneId);
                        if (set) {
                            set.delete(entry);
                            if (set.size === 0) this.activeSounds.delete(cloneId);
                        }
                        try { source.disconnect(); gain.disconnect(); panner.disconnect(); } catch (e) { /* ignore */ }
                        resolve();
                    };

                    source.start(0);
                }).catch((err) => {
                    console.warn('[Polyphonic Sounds] Could not play sound:', err);
                    resolve();
                });
            } catch (err) {
                console.warn('[Polyphonic Sounds] Error:', err);
                resolve();
            }
        });
    }

    _stopTarget(cloneId) {
        const set = this.activeSounds.get(cloneId);
        if (!set) return;
        // Copy first: onended modifies the set
        Array.from(set).forEach(({ source, finish }) => {
            try { source.stop(); } catch (e) { /* already stopped */ }
            finish(); // make sure "until done" threads are released
        });
        this.activeSounds.delete(cloneId);
    }

    _stopAll() {
        Array.from(this.activeSounds.keys()).forEach(id => this._stopTarget(id));
    }
}

window.tempExt = {
    Extension: Extension,
    info: {
        name: 'polyphonicSounds.name',
        description: 'polyphonicSounds.description',
        extensionId: 'polyphonicSounds',
        iconURL: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 height=%2224px%22 width=%2224px%22 fill=%22%23e3e3e3%22%3E%3Cpath d=%22M7.55,19.38Q6.53,18.35 6.53,16.9t1.03-2.47t2.47-1.03q0.57,0 1.08,0.17t0.92,0.51V3.6h5.44V6.87H13.53V16.9q0,1.45-1.03,2.47T10.03,20.4T7.55,19.38Z%22/%3E%3C/svg%3E',
        insetIconURL: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 height=%2224px%22 width=%2224px%22 fill=%22%23e3e3e3%22%3E%3Cpath d=%22M7.55,19.38Q6.53,18.35 6.53,16.9t1.03-2.47t2.47-1.03q0.57,0 1.08,0.17t0.92,0.51V3.6h5.44V6.87H13.53V16.9q0,1.45-1.03,2.47T10.03,20.4T7.55,19.38Z%22/%3E%3C/svg%3E',
        featured: true,
        disabled: false,
        collaborator: ''
    },
    l10n: {
        en: {
            'polyphonicSounds.name': 'Polyphonic & Clone Sounds',
            'polyphonicSounds.description': 'Play overlapping sounds with volume, pitch and pan, and stop sounds per clone.'
        }
    }
};
