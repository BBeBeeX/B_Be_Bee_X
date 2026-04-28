export var AudioQuality;
(function (AudioQuality) {
    AudioQuality["unknown"] = "unknown";
    AudioQuality["low"] = "low";
    AudioQuality["medium"] = "medium";
    AudioQuality["high"] = "high";
    AudioQuality["lossless"] = "lossless";
})(AudioQuality || (AudioQuality = {}));
export const AudioQualityName = {
    [AudioQuality.unknown]: "unknown",
    [AudioQuality.low]: "low",
    [AudioQuality.medium]: "medium",
    [AudioQuality.high]: "high",
    [AudioQuality.lossless]: "lossless",
};
export const AudioQualityPriority = {
    [AudioQuality.unknown]: 0,
    [AudioQuality.low]: 1,
    [AudioQuality.medium]: 2,
    [AudioQuality.high]: 3,
    [AudioQuality.lossless]: 4
};
export var SortMethodEnum;
(function (SortMethodEnum) {
    SortMethodEnum["default_"] = "default";
    SortMethodEnum["createTime"] = "createTime";
    SortMethodEnum["updateTime"] = "updateTime";
    SortMethodEnum["title"] = "title";
})(SortMethodEnum || (SortMethodEnum = {}));
export var RepeatModeEnum;
(function (RepeatModeEnum) {
    RepeatModeEnum["off"] = "off";
    RepeatModeEnum["one"] = "one";
    RepeatModeEnum["all"] = "all";
    RepeatModeEnum["shuffle"] = "shuffle";
})(RepeatModeEnum || (RepeatModeEnum = {}));
