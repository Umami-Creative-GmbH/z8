const fs = require('fs');
const path = require('path');

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findMissingKeys(source, target, prefix = "") {
    let missing = {};
    for (const key in source) {
        const currPath = prefix ? `${prefix}.${key}` : key;
        if (!(key in target)) {
            missing[currPath] = source[key];
        } else if (typeof source[key] === 'object' && source[key] !== null && typeof target[key] === 'object' && target[key] !== null) {
            const childMissing = findMissingKeys(source[key], target[key], currPath);
            Object.assign(missing, childMissing);
        }
    }
    return missing;
}

const baseDir = path.join('apps', 'webapp', 'messages');
console.log('Scanning directory:', path.resolve(baseDir));

const enData = loadJson(path.join(baseDir, 'en.json'));

const languages = ['de', 'es', 'fr', 'it', 'pt'];

const allMissing = {};

languages.forEach(lang => {
    const langFile = path.join(baseDir, `${lang}.json`);
    if (fs.existsSync(langFile)) {
        const langData = loadJson(langFile);
        const missing = findMissingKeys(enData, langData);
        console.log(`Missing keys in ${lang}: ${Object.keys(missing).length}`);
        allMissing[lang] = missing;
    } else {
        console.log(`File not found: ${langFile}`);
    }
});

fs.writeFileSync('missing_keys.json', JSON.stringify(allMissing, null, 2));
