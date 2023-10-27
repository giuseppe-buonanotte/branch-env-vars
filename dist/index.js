"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchEnvVars = exports.getValueForBranch = exports.parseEnvVarPossibilities = exports.parseBranchName = void 0;
var core_1 = require("@actions/core");
var protectedEnvVars = [
    "INPUT_BEVOVERWRITE",
    "INPUT_BEVACTIONONNOREF",
    "INPUT_BEVSETEMPTYVARS",
    "INPUT_BRANCHNAME"
];
var canOverwrite;
var noRefAction;
var setEmptyVars;
// determines the branch we should match to.
// if we're building a branch, returns the branch name.
// if a base ref exists, it'll return !pr>$base_ref
// tags return !tag
// finally, for everything else, we'll return !default
function parseBranchName(ref, baseRef) {
    if (!ref) {
        switch (noRefAction) {
            case "error":
                (0, core_1.setFailed)("Unable to get github.ref/GITHUB_REF");
                return;
            case "warn":
                (0, core_1.warning)("Unable to get github.ref/GITHUB_REF");
                break;
            case "continue":
                break;
            default:
                (0, core_1.setFailed)("Invalid value for bevActionOnNoRef: ".concat(noRefAction));
                return;
        }
    }
    // should look like [heads, my-branch-name] or [pulls, my-pull] or [tags, v0.0.0]
    var sanitizedRef = ref.replace("refs/", "");
    var refType = sanitizedRef.slice(0, sanitizedRef.indexOf("/"));
    //const refSourceName = sanitizedRef.slice(sanitizedRef.indexOf("/") + 1);
    var refSourceName = (0, core_1.getInput)("branchname");
    /* workflow yaml with:
    TEST_ENV_VAR: |
      master:someValueForMaster
      staging:someValueForStaging
      !pr:someValueForAPR
      !tag:someValueForTags
      !default:someDefaultValue
     */
    var branchName = "!default";
    // if there is a base ref, we are building a pr.
    if (baseRef) {
        branchName = "!pr>".concat(baseRef);
    }
    else {
        switch (refType) {
            case "heads":
                branchName = refSourceName;
                break;
            // case "pull":
            //   branchName = `!pr>${baseRef}`;
            //   break;
            case "tags":
                branchName = "!tag";
                break;
        }
    }
    return branchName;
}
exports.parseBranchName = parseBranchName;
function parseEnvVarPossibilities(envVars) {
    return Object.entries(envVars)
        // use only input (uses) data and
        // remove protected var names (settings)
        .filter(function (_a) {
        var name = _a[0];
        return name.startsWith("INPUT_") && !protectedEnvVars.includes(name);
    })
        .map(function (_a) {
        var name = _a[0], value = _a[1];
        // name of the environment variable
        var transformedName = name.replace("INPUT_", "").toUpperCase();
        // handle static environment variables
        if (!value.includes("\n")) {
            return [
                transformedName,
                {
                    "!default": value.trim(),
                },
            ];
        }
        /*
        Here, we reduce the paragraph value of branch:value pairs into
        a JavaScript object with branch names/patterns (like !default) as keys.
        {
          "master": "someValueForMaster",
          "staging": "someValueForStaging",
          // ...
        }
         */
        var possibleValues = value.split("\n").reduce(function (acc, pair) {
            // comment or empty line
            if (pair.trim().startsWith("#") || !pair.trim().length) {
                return acc;
            }
            // find first colon
            var separatorLoc = pair.indexOf(":");
            if (separatorLoc === -1) {
                throw new Error("Invalid value for ".concat(transformedName, ": ").concat(pair, " does not contain a colon"));
            }
            // what environment variable name the values are for
            var valueFor = pair.substring(0, separatorLoc).trim();
            acc[valueFor] = pair.substring(separatorLoc + 1);
            return acc;
        }, {});
        return [transformedName, possibleValues];
    });
}
exports.parseEnvVarPossibilities = parseEnvVarPossibilities;
function getValueForBranch(branchName, possibleValues) {
    var possibleValueKeys = Object.keys(possibleValues);
    // handle wildcards
    var wildcardKeys = possibleValueKeys.filter(function (k) { return k.includes("*"); });
    var key = branchName;
    // if there's a wildcard and no exact match
    if (wildcardKeys.length > 0 && !possibleValues[key]) {
        // find the first branch pattern where the wildcard matches
        var wildcardKey = wildcardKeys.find(function (k) {
            // replace *s with .* and run as regex
            var regex = new RegExp(k.replace(/\*\*/g, ".*").replace(/\*/g, ".*"));
            // return whether the branch name matches the regex
            return regex.test(branchName);
        });
        // if we found a match, wildcardKey will be used. If not, the key will stay as the branch name.
        // so, if key was !pr>staging/* and our branch is staging/1234, key will now be !pr>staging/*.
        key = wildcardKey ? wildcardKey : branchName;
    }
    if (key.startsWith("!pr")) {
        // first, attempt to use the key
        if (possibleValues[key]) {
            return possibleValues[key];
        }
        else if (possibleValues["!pr"]) {
            // if that doesn't work, try to use the default pr matcher
            return possibleValues["!pr"];
        }
        // fallback to default since no pr matched
        return possibleValues["!default"];
    }
    return possibleValues[key] || possibleValues["!default"];
}
exports.getValueForBranch = getValueForBranch;
function branchEnvVars(environmentVariables) {
    try {
        // handle settings
        canOverwrite = (0, core_1.getInput)("bevOverwrite") === "true";
        noRefAction = (0, core_1.getInput)("bevActionOnNoRef");
        setEmptyVars = (0, core_1.getInput)("bevSetEmptyVars") === "true";
        // head ref (branch we're building)
        var ref = environmentVariables.GITHUB_REF;
        // base ref (if on a pr, base we're going to merge into)
        var baseRef = environmentVariables.GITHUB_BASE_REF;
        var branchName_1 = parseBranchName(ref, baseRef);
        parseEnvVarPossibilities(environmentVariables).forEach(function (_a) {
            var name = _a[0], possibleValues = _a[1];
            if (!canOverwrite && !!environmentVariables[name]) {
                return;
            }
            var value = getValueForBranch(branchName_1, possibleValues);
            if (!value) {
                if (setEmptyVars) {
                    (0, core_1.exportVariable)(name, "");
                    (0, core_1.debug)("Exporting ".concat(name, " with an empty value"));
                }
            }
            else {
                (0, core_1.exportVariable)(name, value);
                (0, core_1.debug)("Exporting ".concat(name, " with value ").concat(value));
            }
        });
    }
    catch (e) {
        (0, core_1.setFailed)(e);
    }
}
exports.branchEnvVars = branchEnvVars;
if (!process.env.JEST_WORKER_ID) {
    branchEnvVars(process.env);
}
