class Extension {
    constructor(runtime) {
        this.runtime = runtime;
        this.activeSounds = new Map();   // target.id -> Set of { source, gain, panner, finish, soundName }
        this.bufferCache = new Map();    // assetId -> Promise<AudioBuffer>

        if (runtime && runtime.on) {
            runtime.on('PROJECT_STOP_ALL', () => this._stopAll());
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
            iconURI: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 height=%2224px%22 width=%2224px%22 fill=%22%23ffffff%22%3E%3Cpath d=%22M7.55,19.38Q6.53,18.35 6.53,16.9t1.03-2.47t2.47-1.03q0.57,0 1.08,0.17t0.92,0.51V3.6h5.44V6.87H13.53V16.9q0,1.45-1.03,2.47T10.03,20.4T7.55,19.38Z%22/%3E%3C/svg%3E',
            blockIconURI: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 height=%2224px%22 width=%2224px%22 fill=%22%23ffffff%22%3E%3Cpath d=%22M7.55,19.38Q6.53,18.35 6.53,16.9t1.03-2.47t2.47-1.03q0.57,0 1.08,0.17t0.92,0.51V3.6h5.44V6.87H13.53V16.9q0,1.45-1.03,2.47T10.03,20.4T7.55,19.38Z%22/%3E%3C/svg%3E',
            blocks: [
                {
                    blockType: 'label',
                    text: 'Polyphonic Audio Playback'
                },
                {
                    opcode: 'playSoundPolyWithOptions',
                    blockType: 'command',
                    text: 'play sound [SOUND] with volume [VOL]% pitch [PITCH] pan [PAN] loop [LOOP]',
                    arguments: {
                        SOUND: { type: 'string', menu: 'soundsMenu' },
                        VOL: { type: 'number', defaultValue: 100 },
                        PITCH: { type: 'number', defaultValue: 0 },
                        PAN: { type: 'number', defaultValue: 0 },
                        LOOP: { type: 'string', menu: 'loopMenu', defaultValue: 'off' }
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
                    text: 'Dynamic Sound Modifiers'
                },
                {
                    opcode: 'setSoundProperty',
                    blockType: 'command',
                    text: 'set sound [SOUND] [PROPERTY] to [VALUE] in this clone',
                    arguments: {
                        SOUND: { type: 'string', menu: 'soundsMenu' },
                        PROPERTY: { type: 'string', menu: 'propertyMenu', defaultValue: 'volume' },
                        VALUE: { type: 'number', defaultValue: 100 }
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
                },
                {
                    opcode: 'stopSpecificSound',
                    blockType: 'command',
                    text: 'stop sound [SOUND] in this clone',
                    arguments: {
                        SOUND: { type: 'string', menu: 'soundsMenu' }
                    }
                }
            ],
            menus: {
                soundsMenu: {
                    acceptReporters: true,
                    items: '_getSoundsMenu'
                },
                loopMenu: {
                    items: [
                        { text: 'off', value: 'off' },
                        { text: 'on', value: 'on' }
                    ]
                },
                propertyMenu: {
                    items: [
                        { text: 'volume (%)', value: 'volume' },
                        { text: 'pitch (semitones)', value: 'pitch' },
                        { text: 'pan (-100 to 100)', value: 'pan' }
                    ]
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
        this._startSound(args, util, () => {}).catch(() => {});
    }

    playSoundPolyUntilDone(args, util) {
        return new Promise((resolve) => {
            this._startSound(args, util, resolve).catch(() => resolve());
        });
    }

    setSoundProperty(args, util) {
        if (!util.target) return;
        const cloneId = util.target.id;
        const set = this.activeSounds.get(cloneId);
        if (!set) return;

        const targetSoundName = String(args.SOUND);
        const property = String(args.PROPERTY);
        const rawValue = Number(args.VALUE) || 0;

        Array.from(set).forEach((entry) => {
            if (entry.soundName === targetSoundName) {
                try {
                    if (property === 'volume') {
                        const vol = Math.max(0, Math.min(200, rawValue)) / 100;
                        entry.gain.gain.value = vol;
                    } else if (property === 'pitch') {
                        entry.source.playbackRate.value = Math.pow(2, rawValue / 12);
                    } else if (property === 'pan') {
                        const panVal = Math.max(-100, Math.min(100, rawValue)) / 100;
                        if (entry.panner && entry.panner.pan) {
                            entry.panner.pan.value = panVal;
                        }
                    }
                } catch (e) { /* ignore modification errors */ }
            }
        });
    }

    stopCloneSounds(args, util) {
        if (util.target) this._stopTarget(util.target.id);
    }

    stopSpecificSound(args, util) {
        if (!util.target) return;
        const cloneId = util.target.id;
        const set = this.activeSounds.get(cloneId);
        if (!set) return;

        const targetSoundName = String(args.SOUND);
        Array.from(set).forEach((entry) => {
            if (entry.soundName === targetSoundName) {
                try { entry.source.stop(); } catch (e) { /* already stopped */ }
                set.delete(entry);
                entry.finish();
            }
        });
        if (set.size === 0) this.activeSounds.delete(cloneId);
    }

    /* ---------- Internals ---------- */

    _findSound(target, soundArg) {
        const sounds = target.sprite && target.sprite.sounds;
        if (!sounds || sounds.length === 0) return null;

        const byName = sounds.find(s => s.name === String(soundArg));
        if (byName) return byName;

        const index = Number(soundArg);
        if (!isNaN(index) && index >= 1) {
            return sounds[Math.round(index) - 1] || null;
        }
        return null;
    }

    _getBuffer(target, soundEntry, audioContext) {
        try {
            const bank = target.sprite && target.sprite.soundBank;
            const player = bank && bank.soundPlayers && bank.soundPlayers[soundEntry.soundId];
            if (player && player.buffer) {
                return Promise.resolve(player.buffer);
            }
        } catch (e) { /* fall through */ }

        const key = soundEntry.assetId || soundEntry.soundId || soundEntry.name;
        if (this.bufferCache.has(key)) return this.bufferCache.get(key);

        const asset = soundEntry.asset;
        if (!asset || !asset.data) {
            return Promise.reject(new Error('Sound has no asset data'));
        }
        const d = asset.data;
        const copy = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);

        const promise = new Promise((resolve, reject) => {
            audioContext.decodeAudioData(copy, resolve, reject);
        });
        this.bufferCache.set(key, promise);
        promise.catch(() => this.bufferCache.delete(key));
        return promise;
    }

    _startSound(args, util, onEndedCallback) {
        return new Promise((resolveInner) => {
            try {
                const target = util.target;
                const audioEngine = this.runtime.audioEngine;
                if (!target || !audioEngine || !audioEngine.audioContext) {
                    onEndedCallback();
                    resolveInner();
                    return;
                }

                const soundEntry = this._findSound(target, args.SOUND);
                if (!soundEntry) {
                    onEndedCallback();
                    resolveInner();
                    return;
                }

                const volume = Math.max(0, Math.min(200, Number(args.VOL) || 0)) / 100;
                const pitch = Number(args.PITCH) || 0;
                const pan = Math.max(-100, Math.min(100, Number(args.PAN) || 0)) / 100;
                const isLooping = String(args.LOOP) === 'on';

                const audioContext = audioEngine.audioContext;
                const cloneId = target.id;
                const soundName = soundEntry.name;

                this._getBuffer(target, soundEntry, audioContext).then((buffer) => {
                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }

                    const source = audioContext.createBufferSource();
                    source.buffer = buffer;
                    source.playbackRate.value = Math.pow(2, pitch / 12);
                    source.loop = isLooping;

                    const gain = audioContext.createGain();
                    gain.gain.value = volume;

                    const panner = audioContext.createStereoPanner();
                    panner.pan.value = pan;

                    source.connect(gain);
                    gain.connect(panner);
                    panner.connect(audioEngine.inputNode || audioContext.destination);

                    const entry = { 
                        source, 
                        gain, 
                        panner, 
                        finish: () => {
                            onEndedCallback();
                        }, 
                        soundName 
                    };

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
                        onEndedCallback();
                    };

                    source.start(0);
                    resolveInner();

                    if (isLooping) {
                        onEndedCallback();
                    }
                }).catch((err) => {
                    console.warn('[Polyphonic Sounds] Could not play sound:', err);
                    onEndedCallback();
                    resolveInner();
                });
            } catch (err) {
                console.warn('[Polyphonic Sounds] Error:', err);
                onEndedCallback();
                resolveInner();
            }
        });
    }

    _stopTarget(cloneId) {
        const set = this.activeSounds.get(cloneId);
        if (!set) return;
        Array.from(set).forEach(({ source, finish }) => {
            try { source.stop(); } catch (e) { /* already stopped */ }
            finish();
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
            'polyphonicSounds.description': 'Play overlapping sounds with volume, pitch, pan, loop controls, dynamic property changes, and target-specific stop actions.'
        }
    }
};
