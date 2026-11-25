"use strict";

/**
 * Fields that depend on whether we know when a complaint was posted. Many sources show no date,
 * so the alert only proves the complaint was newly found. Undated alerts rank one level lower
 * and tell sales to check the source first.
 */

const PRIORITY = Object.freeze({
    hot_complaint: { dated: "high", undated: "medium" },
    switching_intent: { dated: "medium", undated: "low" },
});

/** @returns {object} the alert with dateKnown, priority and suggestedAction set (trend alerts unchanged) */
function withDateConfidence(alert) {
    const priority = PRIORITY[alert.type];
    if (!priority) return alert;

    const dateKnown = Boolean(alert.postedAt);
    const action = alert.switchingIntent === "considering"
        ? `Prioritise ${alert.competitorName} prospects this week: lead with the "${alert.painCategoryLabel}" playbook.`
        : `Add this ${alert.competitorName} pain to outreach messaging; see the "${alert.painCategoryLabel}" playbook.`;
    return {
        ...alert,
        dateKnown,
        priority: dateKnown ? priority.dated : priority.undated,
        suggestedAction: dateKnown ? action : `Post date unknown: check the source first. If recent: ${action}`,
    };
}

module.exports = { withDateConfidence };
