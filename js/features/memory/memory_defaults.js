(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const VERSION = '2.15-R0B';
    const DEFAULTS = Object.freeze({
        retrieval: Object.freeze({
            semanticWeight: 0.55,
            tagWeight: 0.35,
            embeddingCandidateLimit: 32,
            semanticHighThreshold: 0.72,
            semanticRelatedThreshold: 0.50,
            recentDays: 14,
            similarThreshold: 0.34,
            localCandidateFloor: 28
        }),
        lifecycle: Object.freeze({
            expiringSoonDays: 30,
            lowConfidenceBlock: 20,
            defaultConfidence: 70,
            healthPenalty: Object.freeze({ conflict: 8, due: 3, duplicateGroup: 4, missingSource: 0.25 }),
            retention: Object.freeze({
                temporary_state: Object.freeze({ mode: 'fixed', halfLife: 7, archive: 30 }),
                reminder: Object.freeze({ mode: 'manual', halfLife: 30, archive: 90 }),
                soft_preference: Object.freeze({ mode: 'decay', halfLife: 180, archive: 720 }),
                historical_context: Object.freeze({ mode: 'decay', halfLife: 365, archive: 1460 }),
                candidate: Object.freeze({ mode: 'manual', halfLife: 30, archive: 180 }),
                default: Object.freeze({ mode: 'permanent', halfLife: 3650, archive: 0 })
            })
        })
    });

    function merge(base, override) {
        if (!override || typeof override !== 'object') return { ...base };
        const result = { ...base };
        Object.entries(override).forEach(([key, value]) => {
            if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') result[key] = merge(base[key], value);
            else result[key] = value;
        });
        return result;
    }

    function resolve(template) {
        const override = template?.memoryDefaults && typeof template.memoryDefaults === 'object' ? template.memoryDefaults : {};
        return Object.freeze({
            retrieval: Object.freeze(merge(DEFAULTS.retrieval, override.retrieval)),
            lifecycle: Object.freeze(merge(DEFAULTS.lifecycle, override.lifecycle))
        });
    }

    Kernel.register('memoryDefaults', Object.freeze({ VERSION, DEFAULTS, resolve }));
})(window);
