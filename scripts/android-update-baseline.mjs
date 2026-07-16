/**
 * Resolves the optional update baseline shared by release-version and APK checks.
 * The policy's first-release flag is required when no prior APK can be compared,
 * so a missing baseline is explicit rather than silently weakening update safety.
 */
export function resolveAndroidUpdateBaseline(policy, currentVersion) {
    if (policy.updateBaseline === null) {
        if (policy.firstReleaseForApplicationId !== true) {
            throw new Error(
                'Android updateBaseline may be null only for the first release of an applicationId',
            )
        }
        if (policy.firstReleaseVersion !== currentVersion) {
            throw new Error(
                `Android null updateBaseline is limited to firstReleaseVersion ${policy.firstReleaseVersion ?? '<missing>'}`,
            )
        }
        return null
    }

    const tag = policy.updateBaseline?.tag
    const match = typeof tag === 'string' ? /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) : null
    if (!match) {
        throw new Error('Android updateBaseline tag must use the stable v<major>.<minor>.<patch> form')
    }
    if (policy.firstReleaseForApplicationId !== false) {
        throw new Error('Android updateBaseline requires firstReleaseForApplicationId to be false')
    }
    const [major, minor, patch] = match.slice(1).map(Number)
    const versionCode = major * 1_000_000 + minor * 1_000 + patch
    if (minor >= 1_000 || patch >= 1_000 || !Number.isSafeInteger(versionCode) || versionCode > 2_100_000_000) {
        throw new Error('Android updateBaseline is outside the supported versionCode range')
    }
    return tag
}
