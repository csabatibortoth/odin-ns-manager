// The blocking as a whole: its settings, and the decision whether a name is blocked.
const BlockEntry = require('../../model/mongoDB/blockEntryModel');
const BlockList = require('../../model/mongoDB/blockListModel');
const BlockRule = require('../../model/mongoDB/blockRuleModel');
const BlockSettings = require('../../model/mongoDB/blockSettingsModel');
const dnsData = require('../dnsService/dnsData');
const HttpError = require('../httpError');
const logService = require('../logService/logService');

// The settings are stored on the first change; until then the defaults of the model apply.
const loadSettings = async () => (await BlockSettings.findById(BlockSettings.ID)) ?? new BlockSettings();

async function getSettings() {
    return (await loadSettings()).toJSON();
}

// data: { enabled?, mode? }
async function updateSettings(data, actor) {
    dnsData.assertOnly(data, ['enabled', 'mode']);
    if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

    const settings = await loadSettings();
    if (data.enabled !== undefined) {
        if (typeof data.enabled !== 'boolean') throw dnsData.invalid({ enabled: 'enabled must be true or false' });
        settings.enabled = data.enabled;
    }
    if (data.mode !== undefined) {
        if (!BlockSettings.MODES.includes(data.mode)) {
            throw dnsData.invalid({ mode: `mode must be one of: ${BlockSettings.MODES.join(', ')}` });
        }
        settings.mode = data.mode;
    }

    await settings.save();
    logService.addInfoLogBasicInfoEntry(
        'Blocking settings updated: ', settings.enabled ? 'enabled' : 'disabled', ', ', settings.mode, ' by ', actor?.username
    );
    return settings.toJSON();
}

// The name itself, followed by the domains above it: a.b.example.com, b.example.com, example.com, com.
function withParents(name) {
    const labels = name.split('.');
    return labels.map((label, index) => labels.slice(index).join('.'));
}

// Tells whether a name is blocked, and why. The order of the decision, which a name server must follow as well:
//   1. the rule of the name itself, or else of the nearest domain above it that includes its subdomains;
//   2. without a rule, the active block lists that hold exactly this name.
async function check(value) {
    const domain = dnsData.parseDomainName(value, { field: 'domain' });
    const names = withParents(domain);

    const [settings, rules, listIds] = await Promise.all([
        loadSettings(),
        BlockRule.find({ domain: { $in: names }, active: true }).lean(),
        BlockEntry.distinct('list', { domain }),
    ]);
    const lists = listIds.length
        ? await BlockList.find({ _id: { $in: listIds }, active: true }).select('name').sort({ name: 1 }).lean()
        : [];

    const applies = (rule) => rule.domain === domain || rule.includeSubdomains;
    const rule = names.map((name) => rules.find((candidate) => candidate.domain === name && applies(candidate))).find(Boolean);
    const matched = rule ? rule.action === 'block' : lists.length > 0;

    return {
        domain,
        // False while the blocking is switched off, whatever the rules and lists say.
        blocked: settings.enabled && matched,
        enabled: settings.enabled,
        mode: settings.mode,
        rule: rule ? BlockRule.toPublic(rule) : null,
        lists: lists.map((list) => ({ id: String(list._id), name: list.name })),
    };
}

module.exports = {
    getSettings,
    updateSettings,
    check,
};
