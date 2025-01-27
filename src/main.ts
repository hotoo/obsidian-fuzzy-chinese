import { App, Notice, Plugin, PluginSettingTab, Setting, EditorSuggest } from "obsidian";
import { Pinyin, PinyinIndex, runOnLayoutReady } from "./utils";
import FuzzyModal from "./fuzzyModal";
import FuzzyFileModal from "./fuzzyFileModal";
import FuzzyFolderModal from "./fuzzyFolderModal";
import FuzzyCommandModal from "./fuzzyCommandModal";
import FileEditorSuggest from "./fileEditorSuggest";
import TagEditorSuggest from "./tagEditorSuggest";
import FuzzySuggestModal from "./fuzzySuggestModal";
// 以下两个字典来源于：https://github.com/xmflswood/pinyin-match
import SimplifiedDict from "./simplified_dict";
import TraditionalDict from "./traditional_dict";

import DoublePinyinDict from "./double_pinyin";

interface FuzyyChinesePinyinSettings {
    global: {
        traditionalChineseSupport: boolean;
        doublePinyin: string;
        closeWithBackspace: boolean;
    };
    file: {
        showAllFileTypes: boolean;
        showAttachments: boolean;
        attachmentExtensions: Array<string>;
        usePathToSearch: boolean;
        useFileEditorSuggest: boolean;
        showPath: boolean;
        showTags: boolean;
        historyDisplay: string;
    };
    other: {
        useTagEditorSuggest: boolean;
        devMode: boolean;
    };
}

const DEFAULT_SETTINGS: FuzyyChinesePinyinSettings = {
    global: {
        traditionalChineseSupport: false,
        doublePinyin: "全拼",
        closeWithBackspace: false,
    },
    file: {
        showAttachments: false,
        showAllFileTypes: false,
        attachmentExtensions: [
            "bmp",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "svg",
            "webp",
            "mp3",
            "wav",
            "m4a",
            "3gp",
            "flac",
            "ogg",
            "oga",
            "opus",
            "mp4",
            "webm",
            "ogv",
            "mov",
            "mkv",
            "pdf",
        ],
        usePathToSearch: false,
        useFileEditorSuggest: false,
        showPath: true,
        showTags: false,
        historyDisplay: "使用完整路径",
    },
    other: {
        useTagEditorSuggest: false,
        devMode: false,
    },
};

export default class FuzzyChinesePinyinPlugin extends Plugin {
    settings: FuzyyChinesePinyinSettings;
    pinyinDict: { originalKeys: any; keys: string[]; values: string[] };
    api: any;
    fileModal: FuzzyFileModal;
    folderModal: FuzzyFolderModal;
    commandModal: FuzzyCommandModal;
    fileEditorSuggest: FileEditorSuggest;
    tagEditorSuggest: TagEditorSuggest;
    indexManager: IndexManager;
    editorSuggests: EditorSuggest<any>[];

    loadPinyinDict() {
        let PinyinKeys_ = this.settings.global.traditionalChineseSupport ? Object.keys(TraditionalDict) : Object.keys(SimplifiedDict);
        let PinyinValues = this.settings.global.traditionalChineseSupport ? Object.values(TraditionalDict) : Object.values(SimplifiedDict);
        let PinyinKeys =
            this.settings.global.doublePinyin == "全拼"
                ? PinyinKeys_
                : PinyinKeys_.map((p) => fullPinyin2doublePinyin(p, DoublePinyinDict[this.settings.global.doublePinyin]));

        // originalKeys 永远是全拼的拼音，keys 是转换后的拼音（可能也是全拼或双拼）
        this.pinyinDict = { keys: PinyinKeys, values: PinyinValues, originalKeys: PinyinKeys_ };
    }

    async onload() {
        await this.loadSettings();

        this.loadPinyinDict();
        this.fileModal = new FuzzyFileModal(this.app, this);
        this.folderModal = new FuzzyFolderModal(this.app, this);
        this.commandModal = new FuzzyCommandModal(this.app, this);
        this.fileEditorSuggest = new FileEditorSuggest(this.app, this);
        this.tagEditorSuggest = new TagEditorSuggest(this.app, this);

        this.indexManager = new IndexManager(this, [this.folderModal, this.fileModal, this.commandModal, this.tagEditorSuggest]);
        this.editorSuggests = [this.fileEditorSuggest, this.tagEditorSuggest];

        if (this.settings.file.useFileEditorSuggest) {
            this.app.workspace.editorSuggest.suggests.unshift(this.fileEditorSuggest);
        }
        if (this.settings.other.useTagEditorSuggest) {
            this.app.workspace.editorSuggest.suggests.unshift(this.tagEditorSuggest);
        }

        runOnLayoutReady(() => {
            if (this.settings.other.devMode) {
                this.indexManager.devLoad();
                globalThis.refreshFuzzyChineseIndex = () => {
                    globalThis.FuzzyChineseIndex = {};
                    this.indexManager.load();
                };
            } else {
                this.indexManager.load();
            }
        });
        this.addCommand({
            id: "open-search",
            name: "Open Search",
            checkCallback: (checking: boolean) => {
                let leaf = this.app.workspace.getMostRecentLeaf();
                if (leaf) {
                    if (!checking) {
                        this.fileModal.open();
                    }
                    return true;
                }
                return false;
            },
        });
        this.addCommand({
            id: "move-file",
            name: "Move File",
            checkCallback: (checking: boolean) => {
                let file = app.workspace.getActiveFile();
                if (file) {
                    if (!checking) {
                        this.folderModal.open();
                    }
                    return true;
                }
                return false;
            },
        });
        this.addCommand({
            id: "execute-command",
            name: "Execute Command",
            checkCallback: (checking: boolean) => {
                if (!checking) {
                    this.commandModal.open();
                }
                return true;
            },
        });
        this.addRibbonIcon("search", "FuzzySearch", () => {
            let leaf = this.app.workspace.getMostRecentLeaf();
            if (leaf) {
                this.fileModal.open();
                return true;
            }
            return false;
        });
        this.addSettingTab(new SettingTab(this.app, this));
        this.api = { suggester: this.suggester };
    }
    onunload() {
        this.editorSuggests.forEach((editorSuggest) => this.app.workspace.editorSuggest.removeSuggest(editorSuggest));
        if (this.settings.other.devMode) {
            this.indexManager.devUnload();
        }
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    async suggester(text_items: string[], items: any[]): Promise<string> {
        let modal = new FuzzySuggestModal(app, this, text_items, items);
        const promise: Promise<string> = new Promise((resolve: (value?: string) => void, reject) => modal.openAndGetValue(resolve, reject));
        return await promise;
    }
}

class SettingTab extends PluginSettingTab {
    plugin: FuzzyChinesePinyinPlugin;
    constructor(app: App, plugin: FuzzyChinesePinyinPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display(): void {
        let { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h1", { text: "设置" });
        containerEl.createEl("h2", { text: "全局" });
        new Setting(containerEl)
            .setName("Backspace 关闭搜索")
            .setDesc("当输入框为空时按下 Backspace 关闭搜索")
            .addToggle((text) =>
                text.setValue(this.plugin.settings.global.closeWithBackspace).onChange(async (value) => {
                    this.plugin.settings.global.closeWithBackspace = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl).setName("繁体支持").addToggle((text) => {
            text.setValue(this.plugin.settings.global.traditionalChineseSupport).onChange(async (value) => {
                this.plugin.settings.global.traditionalChineseSupport = value;
                await this.plugin.saveSettings();
                this.plugin.loadPinyinDict();
            });
        });
        new Setting(containerEl).setName("双拼方案").addDropdown((text) =>
            text
                .addOptions({
                    全拼: "全拼",
                    智能ABC: "智能ABC",
                    小鹤双拼: "小鹤双拼",
                    微软双拼: "微软双拼",
                })
                .setValue(this.plugin.settings.global.doublePinyin)
                .onChange(async (value: string) => {
                    this.plugin.settings.global.doublePinyin = value;
                    this.plugin.pinyinDict.keys =
                        value == "全拼"
                            ? this.plugin.pinyinDict.originalKeys
                            : this.plugin.pinyinDict.originalKeys.map((p) => fullPinyin2doublePinyin(p, DoublePinyinDict[value]));
                    this.plugin.fileModal.index.initIndex();
                    new Notice("双拼方案切换为：" + value, 4000);
                    await this.plugin.saveSettings();
                })
        );
        containerEl.createEl("h2", { text: "文件搜索" });
        new Setting(containerEl)
            .setName("显示附件")
            .setDesc("显示如图片、视频、PDF等附件文件。")
            .addToggle((text) =>
                text.setValue(this.plugin.settings.file.showAttachments).onChange(async (value) => {
                    this.plugin.settings.file.showAttachments = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl).setName("显示所有类型文件").addToggle((text) =>
            text.setValue(this.plugin.settings.file.showAllFileTypes).onChange(async (value) => {
                this.plugin.settings.file.showAllFileTypes = value;
                await this.plugin.saveSettings();
            })
        );
        new Setting(containerEl)
            .setName("使用路径搜索")
            .setDesc("当搜索结果少于10个时搜索路径")
            .addToggle((text) =>
                text.setValue(this.plugin.settings.file.usePathToSearch).onChange(async (value) => {
                    this.plugin.settings.file.usePathToSearch = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl).setName("显示路径").addToggle((text) =>
            text.setValue(this.plugin.settings.file.showPath).onChange(async (value) => {
                this.plugin.settings.file.showPath = value;
                await this.plugin.saveSettings();
            })
        );
        new Setting(containerEl).setName("显示 Tag").addToggle((text) =>
            text.setValue(this.plugin.settings.file.showTags).onChange(async (value) => {
                this.plugin.settings.file.showTags = value;
                await this.plugin.saveSettings();
            })
        );
        new Setting(containerEl)
            .setName("使用双链建议")
            .setDesc("输入[[的时候文件连接能支持中文拼音搜索（实验性功能）")
            .addToggle((text) =>
                text.setValue(this.plugin.settings.file.useFileEditorSuggest).onChange(async (value) => {
                    this.plugin.settings.file.useFileEditorSuggest = value;
                    if (value) {
                        this.app.workspace.editorSuggest.suggests.unshift(this.plugin.fileEditorSuggest);
                    } else {
                        this.app.workspace.editorSuggest.removeSuggest(this.plugin.fileEditorSuggest);
                    }
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl).setName("历史记录").addDropdown((text) =>
            text
                .addOptions({
                    使用完整路径: "使用完整路径",
                    仅使用文件名: "仅使用文件名",
                })
                .setValue(this.plugin.settings.file.historyDisplay)
                .onChange(async (value: string) => {
                    this.plugin.settings.file.historyDisplay = value;
                    await this.plugin.saveSettings();
                })
        );
        new Setting(containerEl)
            .setName("附件后缀")
            .setDesc("只显示这些后缀的附件")
            .addTextArea((text) => {
                text.inputEl.addClass("fuzzy-chinese-attachment-extensions");
                text.setValue(this.plugin.settings.file.attachmentExtensions.join("\n")).onChange(async (value) => {
                    this.plugin.settings.file.attachmentExtensions = value
                        .trim()
                        .split("\n")
                        .map((x) => x.trim());
                    await this.plugin.saveSettings();
                });
            });
        containerEl.createEl("h2", { text: "其他" });
        new Setting(containerEl)
            .setName("使用标签建议")
            .setDesc("实验性功能")
            .addToggle((text) =>
                text.setValue(this.plugin.settings.other.useTagEditorSuggest).onChange(async (value) => {
                    this.plugin.settings.other.useTagEditorSuggest = value;
                    if (value) {
                        this.app.workspace.editorSuggest.suggests.unshift(this.plugin.tagEditorSuggest);
                    } else {
                        this.app.workspace.editorSuggest.removeSuggest(this.plugin.tagEditorSuggest);
                    }
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("dev 模式")
            .setDesc("将索引存储到 global 以便重启时不重建索引")
            .addToggle((text) =>
                text.setValue(this.plugin.settings.other.devMode).onChange(async (value) => {
                    this.plugin.settings.other.devMode = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}

function fullPinyin2doublePinyin(fullPinyin: string, doublePinyinDict): string {
    let doublePinyin = "";
    let findKeys = (obj, condition) => {
        return Object.keys(obj).find((key) => condition(obj[key]));
    };
    if (["sh", "ch", "zh"].some((p) => fullPinyin.startsWith(p))) {
        doublePinyin += findKeys(doublePinyinDict, (p) => p.includes(fullPinyin.slice(0, 2)));
        fullPinyin = fullPinyin.slice(2);
    } else {
        doublePinyin += fullPinyin[0];
        fullPinyin = fullPinyin.slice(1);
    }
    if (fullPinyin.length != 0) doublePinyin += findKeys(doublePinyinDict, (p) => p.includes(fullPinyin));
    return doublePinyin;
}

class IndexManager extends Array<PinyinIndex<any>> {
    plugin: FuzzyChinesePinyinPlugin;
    constructor(plugin: FuzzyChinesePinyinPlugin, com: Array<FuzzyModal<any> | EditorSuggest<any>>) {
        super();
        com.forEach((p: any) => this.push(p.index));
        this.plugin = plugin;
    }
    load() {
        this.forEach((index) => this.load_(index));
    }
    load_(index: PinyinIndex<any>) {
        let startTime = Date.now();
        index.initIndex();
        console.log(
            `Fuzzy Chinese Pinyin: ${index.id} indexing completed, totaling ${index.items.length} items, taking ${
                (Date.now() - startTime) / 1000.0
            }s`
        );
    }
    devLoad() {
        this.forEach((index) => {
            if (globalThis.FuzzyChineseIndex && globalThis.FuzzyChineseIndex[index.id]) {
                index.items = globalThis.FuzzyChineseIndex[index.id];
                console.log(`Fuzzy Chinese Pinyin: Use old ${index.id} index`);
            } else {
                this.load_(index);
            }
        });
    }
    devUnload() {
        globalThis.FuzzyChineseIndex = {};
        this.forEach((index) => {
            globalThis.FuzzyChineseIndex[index.id] = index.items;
        });
    }
}
