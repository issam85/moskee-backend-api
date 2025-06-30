// services/calculationService.js

/**
 * Berekent de contributie op basis van het aantal actieve kinderen en de staffel-instellingen van een moskee.
 * @param {number} childCount - Het aantal actieve kinderen.
 * @param {object} mosqueSettings - Het moskee-object met de contributievelden.
 * @returns {number} Het verschuldigde bedrag.
 */
const calculateAmountDueFromStaffel = (childCount, mosqueSettings) => {
    if (!mosqueSettings) {
        console.warn("[WARN] calculateAmountDue: mosqueSettings is missing. Using hardcoded fallbacks.");
        // Veilige fallback
        if (childCount <= 0) return 0;
        if (childCount === 1) return 150;
        if (childCount === 2) return 300;
        return 450;
    }
    
    if (childCount <= 0) return 0;
    if (childCount === 1) return parseFloat(mosqueSettings.contribution_1_child ?? 150);
    if (childCount === 2) return parseFloat(mosqueSettings.contribution_2_children ?? 300);
    if (childCount === 3) return parseFloat(mosqueSettings.contribution_3_children ?? 450);
    if (childCount === 4) return parseFloat(mosqueSettings.contribution_4_children ?? 450);
    return parseFloat(mosqueSettings.contribution_5_plus_children ?? 450);
};

module.exports = { calculateAmountDueFromStaffel };