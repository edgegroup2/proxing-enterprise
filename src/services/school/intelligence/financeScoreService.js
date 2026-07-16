'use strict';

async function calculateFinanceScore(schoolId) {

    const finance = 90;

    return {
        score: finance,
        metrics: {
            collectionRate: 95,
            outstandingAccounts: 18,
            monthlyRevenue: 49500,
            invoicesPaid: 91
        }
    };

}

module.exports = {
    calculateFinanceScore
};
