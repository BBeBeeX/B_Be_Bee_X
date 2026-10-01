#ifndef JSON_HPP
#define JSON_HPP

#include <string>
#include <vector>
#include <map>
#include <sstream>
#include <cctype>
#include <cstdlib>
#include <stdexcept>
#include <iomanip>

namespace audio_engine {

class JsonValue {
public:
    enum Type { TYPE_NULL, TYPE_BOOL, TYPE_NUMBER, TYPE_STRING, TYPE_ARRAY, TYPE_OBJECT };

    Type type = TYPE_NULL;
    bool boolVal = false;
    double numVal = 0.0;
    std::string strVal;
    std::vector<JsonValue> arrVal;
    std::map<std::string, JsonValue> objVal;

    JsonValue() : type(TYPE_NULL) {}
    JsonValue(bool b) : type(TYPE_BOOL), boolVal(b) {}
    JsonValue(double n) : type(TYPE_NUMBER), numVal(n) {}
    JsonValue(int n) : type(TYPE_NUMBER), numVal(static_cast<double>(n)) {}
    JsonValue(int64_t n) : type(TYPE_NUMBER), numVal(static_cast<double>(n)) {}
    JsonValue(const char* s) : type(TYPE_STRING), strVal(s ? s : "") {}
    JsonValue(const std::string& s) : type(TYPE_STRING), strVal(s) {}

    static JsonValue array() {
        JsonValue v;
        v.type = TYPE_ARRAY;
        return v;
    }

    static JsonValue object() {
        JsonValue v;
        v.type = TYPE_OBJECT;
        return v;
    }

    bool isNull() const { return type == TYPE_NULL; }
    bool isBool() const { return type == TYPE_BOOL; }
    bool isNumber() const { return type == TYPE_NUMBER; }
    bool isString() const { return type == TYPE_STRING; }
    bool isArray() const { return type == TYPE_ARRAY; }
    bool isObject() const { return type == TYPE_OBJECT; }

    bool asBool(bool defaultVal = false) const {
        return isBool() ? boolVal : defaultVal;
    }

    double asNumber(double defaultVal = 0.0) const {
        return isNumber() ? numVal : defaultVal;
    }

    int asInt(int defaultVal = 0) const {
        return isNumber() ? static_cast<int>(numVal) : defaultVal;
    }

    int64_t asInt64(int64_t defaultVal = 0) const {
        return isNumber() ? static_cast<int64_t>(numVal) : defaultVal;
    }

    std::string asString(const std::string& defaultVal = "") const {
        return isString() ? strVal : defaultVal;
    }

    bool has(const std::string& key) const {
        if (!isObject()) return false;
        return objVal.find(key) != objVal.end();
    }

    const JsonValue& get(const std::string& key) const {
        static const JsonValue nullVal;
        if (!isObject()) return nullVal;
        auto it = objVal.find(key);
        return (it != objVal.end()) ? it->second : nullVal;
    }

    JsonValue& operator[](const std::string& key) {
        if (type != TYPE_OBJECT) {
            type = TYPE_OBJECT;
            objVal.clear();
        }
        return objVal[key];
    }

    const JsonValue& operator[](size_t index) const {
        static const JsonValue nullVal;
        if (!isArray() || index >= arrVal.size()) return nullVal;
        return arrVal[index];
    }

    void push_back(const JsonValue& val) {
        if (type != TYPE_ARRAY) {
            type = TYPE_ARRAY;
            arrVal.clear();
        }
        arrVal.push_back(val);
    }

    std::string serialize() const {
        std::ostringstream ss;
        serializeInternal(ss);
        return ss.str();
    }

    static JsonValue parse(const std::string& str) {
        size_t pos = 0;
        skipWhitespace(str, pos);
        return parseValue(str, pos);
    }

private:
    void serializeInternal(std::ostringstream& ss) const {
        switch (type) {
            case TYPE_NULL:
                ss << "null";
                break;
            case TYPE_BOOL:
                ss << (boolVal ? "true" : "false");
                break;
            case TYPE_NUMBER:
                if (numVal == static_cast<int64_t>(numVal)) {
                    ss << static_cast<int64_t>(numVal);
                } else {
                    ss << std::setprecision(10) << numVal;
                }
                break;
            case TYPE_STRING:
                ss << '"';
                for (char c : strVal) {
                    if (c == '"') ss << "\\\"";
                    else if (c == '\\') ss << "\\\\";
                    else if (c == '\b') ss << "\\b";
                    else if (c == '\f') ss << "\\f";
                    else if (c == '\n') ss << "\\n";
                    else if (c == '\r') ss << "\\r";
                    else if (c == '\t') ss << "\\t";
                    else ss << c;
                }
                ss << '"';
                break;
            case TYPE_ARRAY:
                ss << '[';
                for (size_t i = 0; i < arrVal.size(); ++i) {
                    if (i > 0) ss << ',';
                    arrVal[i].serializeInternal(ss);
                }
                ss << ']';
                break;
            case TYPE_OBJECT:
                ss << '{';
                bool first = true;
                for (const auto& kv : objVal) {
                    if (!first) ss << ',';
                    first = false;
                    ss << '"' << kv.first << "\":";
                    kv.second.serializeInternal(ss);
                }
                ss << '}';
                break;
        }
    }

    static void skipWhitespace(const std::string& s, size_t& pos) {
        while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t' || s[pos] == '\n' || s[pos] == '\r')) {
            ++pos;
        }
    }

    static JsonValue parseValue(const std::string& s, size_t& pos) {
        skipWhitespace(s, pos);
        if (pos >= s.size()) return JsonValue();

        char c = s[pos];
        if (c == 'n') {
            if (s.compare(pos, 4, "null") == 0) { pos += 4; return JsonValue(); }
        } else if (c == 't') {
            if (s.compare(pos, 4, "true") == 0) { pos += 4; return JsonValue(true); }
        } else if (c == 'f') {
            if (s.compare(pos, 5, "false") == 0) { pos += 5; return JsonValue(false); }
        } else if (c == '"') {
            return parseString(s, pos);
        } else if (c == '[') {
            return parseArray(s, pos);
        } else if (c == '{') {
            return parseObject(s, pos);
        } else if (c == '-' || (c >= '0' && c <= '9')) {
            return parseNumber(s, pos);
        }
        return JsonValue();
    }

    static JsonValue parseString(const std::string& s, size_t& pos) {
        ++pos; // skip opening quote
        std::string result;
        while (pos < s.size()) {
            char c = s[pos++];
            if (c == '"') return JsonValue(result);
            if (c == '\\' && pos < s.size()) {
                char esc = s[pos++];
                if (esc == '"') result += '"';
                else if (esc == '\\') result += '\\';
                else if (esc == '/') result += '/';
                else if (esc == 'b') result += '\b';
                else if (esc == 'f') result += '\f';
                else if (esc == 'n') result += '\n';
                else if (esc == 'r') result += '\r';
                else if (esc == 't') result += '\t';
                else result += esc;
            } else {
                result += c;
            }
        }
        return JsonValue(result);
    }

    static JsonValue parseNumber(const std::string& s, size_t& pos) {
        size_t start = pos;
        if (s[pos] == '-') ++pos;
        while (pos < s.size() && ((s[pos] >= '0' && s[pos] <= '9') || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E' || s[pos] == '+' || s[pos] == '-')) {
            ++pos;
        }
        std::string numStr = s.substr(start, pos - start);
        double val = std::strtod(numStr.c_str(), nullptr);
        return JsonValue(val);
    }

    static JsonValue parseArray(const std::string& s, size_t& pos) {
        ++pos; // skip '['
        JsonValue arr = JsonValue::array();
        skipWhitespace(s, pos);
        if (pos < s.size() && s[pos] == ']') {
            ++pos;
            return arr;
        }
        while (pos < s.size()) {
            arr.push_back(parseValue(s, pos));
            skipWhitespace(s, pos);
            if (pos < s.size() && s[pos] == ',') {
                ++pos;
                skipWhitespace(s, pos);
            } else if (pos < s.size() && s[pos] == ']') {
                ++pos;
                break;
            } else {
                break;
            }
        }
        return arr;
    }

    static JsonValue parseObject(const std::string& s, size_t& pos) {
        ++pos; // skip '{'
        JsonValue obj = JsonValue::object();
        skipWhitespace(s, pos);
        if (pos < s.size() && s[pos] == '}') {
            ++pos;
            return obj;
        }
        while (pos < s.size()) {
            skipWhitespace(s, pos);
            if (pos >= s.size() || s[pos] != '"') break;
            JsonValue keyVal = parseString(s, pos);
            std::string key = keyVal.asString();
            skipWhitespace(s, pos);
            if (pos < s.size() && s[pos] == ':') {
                ++pos;
            } else {
                break;
            }
            skipWhitespace(s, pos);
            obj[key] = parseValue(s, pos);
            skipWhitespace(s, pos);
            if (pos < s.size() && s[pos] == ',') {
                ++pos;
                skipWhitespace(s, pos);
            } else if (pos < s.size() && s[pos] == '}') {
                ++pos;
                break;
            } else {
                break;
            }
        }
        return obj;
    }
};

} // namespace audio_engine

#endif // JSON_HPP
