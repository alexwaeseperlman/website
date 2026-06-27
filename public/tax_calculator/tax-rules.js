const usFederalBrackets2026 = [
  { upTo: 12400, rate: 0.10 },
  { upTo: 50400, rate: 0.12 },
  { upTo: 105700, rate: 0.22 },
  { upTo: 201775, rate: 0.24 },
  { upTo: 256225, rate: 0.32 },
  { upTo: 640600, rate: 0.35 },
  { upTo: null, rate: 0.37 },
];

const canadaFederalBrackets2026 = [
  { upTo: 58523, rate: 0.14 },
  { upTo: 117045, rate: 0.205 },
  { upTo: 181440, rate: 0.26 },
  { upTo: 258482, rate: 0.29 },
  { upTo: null, rate: 0.33 },
];

export const supportedCurrencies = [
  { code: "USD", label: "US dollars" },
  { code: "CAD", label: "Canadian dollars" },
  { code: "HKD", label: "Hong Kong dollars" },
];

export const defaultUsdToCurrency = {
  USD: 1,
  CAD: 1.37,
  HKD: 7.80,
};

function roundCents(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function clampTax(amount) {
  return roundCents(Math.max(0, amount));
}

function progressiveTax(income, brackets) {
  let lower = 0;
  let tax = 0;
  const rows = [];

  for (const bracket of brackets) {
    const upper = bracket.upTo == null ? Infinity : bracket.upTo;
    const taxableAtRate = Math.max(0, Math.min(income, upper) - lower);
    const taxAtRate = taxableAtRate * bracket.rate;

    if (taxableAtRate > 0) {
      rows.push({
        amount: taxableAtRate,
        rate: bracket.rate,
        tax: roundCents(taxAtRate),
      });
    }

    tax += taxAtRate;
    if (income <= upper) break;
    lower = upper;
  }

  return { tax: roundCents(tax), rows };
}

function creditFromTable(income, table) {
  const match = table.find((row) => income <= row.upTo || row.upTo == null);
  return match ? match.amount : 0;
}

function zeroBucket(label, note) {
  return {
    label,
    taxYear: "current",
    calculate() {
      return {
        amount: 0,
        taxableIncome: 0,
        details: [note],
      };
    },
  };
}

function convertCurrency(amount, fromCurrency, toCurrency, usdToCurrency) {
  const fromRate = sanitizeRate(usdToCurrency[fromCurrency]);
  const toRate = sanitizeRate(usdToCurrency[toCurrency]);
  const amountInUsd = amount / fromRate;
  return amountInUsd * toRate;
}

function sanitizeRate(rate) {
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function calculateUsFederal2026(income) {
  const standardDeduction = 16100;
  const taxableIncome = Math.max(0, income - standardDeduction);
  const regularTax = progressiveTax(taxableIncome, usFederalBrackets2026);

  return {
    amount: regularTax.tax,
    taxableIncome,
    details: [
      `2026 single standard deduction: ${formatPlainMoney(standardDeduction)}.`,
      "No federal credits are modeled.",
    ],
  };
}

function canadaBasicPersonalAmount2026(income) {
  if (income <= 181440) return 16452;
  if (income >= 258482) return 14829;
  return 16452 - (income - 181440) * (1623 / 77042);
}

function calculateCanadaFederal2026(income, options = {}) {
  const basicTax = progressiveTax(income, canadaFederalBrackets2026).tax;
  const basicPersonalAmount = canadaBasicPersonalAmount2026(income);
  const employmentAmount = Math.min(income, 1501);
  const credits = (basicPersonalAmount + employmentAmount) * 0.14;
  const taxAfterCredits = Math.max(0, basicTax - credits);
  const quebecAbatement = options.quebecAbatement ? taxAfterCredits * 0.165 : 0;
  const amount = clampTax(taxAfterCredits - quebecAbatement);
  const details = [
    `2026 basic personal amount: ${formatPlainMoney(basicPersonalAmount)}.`,
    `Canada employment amount modeled: ${formatPlainMoney(employmentAmount)}.`,
  ];

  if (options.quebecAbatement) {
    details.push(`Quebec abatement: ${formatPlainMoney(quebecAbatement)}.`);
  }

  return {
    amount,
    taxableIncome: income,
    details,
  };
}

const taxComponents = {
  usFederal2026: {
    label: "United States federal",
    taxYear: "2026",
    calculate: calculateUsFederal2026,
  },

  california2025: {
    label: "California",
    taxYear: "2025 latest available",
    calculate(income) {
      const standardDeduction = 5706;
      const taxableIncome = Math.max(0, income - standardDeduction);
      const brackets = [
        { upTo: 11079, rate: 0.01 },
        { upTo: 26264, rate: 0.02 },
        { upTo: 41452, rate: 0.04 },
        { upTo: 57542, rate: 0.06 },
        { upTo: 72724, rate: 0.08 },
        { upTo: 371479, rate: 0.093 },
        { upTo: 445771, rate: 0.103 },
        { upTo: 742953, rate: 0.113 },
        { upTo: null, rate: 0.123 },
      ];
      const regularTax = progressiveTax(taxableIncome, brackets).tax;
      const phaseoutSteps = Math.ceil(Math.max(0, income - 252203) / 2500);
      const personalCredit = Math.max(0, 153 - 6 * phaseoutSteps);
      const behavioralHealthTax = Math.max(0, taxableIncome - 1000000) * 0.01;
      const amount = clampTax(Math.max(0, regularTax - personalCredit) + behavioralHealthTax);

      return {
        amount,
        taxableIncome,
        details: [
          `California standard deduction: ${formatPlainMoney(standardDeduction)}.`,
          `Personal exemption credit modeled: ${formatPlainMoney(personalCredit)}.`,
          `Behavioral Health Services Tax over $1,000,000: ${formatPlainMoney(behavioralHealthTax)}.`,
        ],
      };
    },
  },

  newYorkState2026: {
    label: "New York State",
    taxYear: "2026",
    calculate(income) {
      const standardDeduction = 8000;
      const taxableIncome = Math.max(0, income - standardDeduction);
      const brackets = [
        { upTo: 8500, rate: 0.039 },
        { upTo: 11700, rate: 0.044 },
        { upTo: 13900, rate: 0.0515 },
        { upTo: 80650, rate: 0.054 },
        { upTo: 215400, rate: 0.059 },
        { upTo: 1077550, rate: 0.0685 },
        { upTo: 5000000, rate: 0.0965 },
        { upTo: 25000000, rate: 0.103 },
        { upTo: null, rate: 0.109 },
      ];
      const householdCredit = creditFromTable(income, [
        { upTo: 5000, amount: 75 },
        { upTo: 6000, amount: 60 },
        { upTo: 7000, amount: 50 },
        { upTo: 20000, amount: 45 },
        { upTo: 25000, amount: 40 },
        { upTo: 28000, amount: 20 },
        { upTo: null, amount: 0 },
      ]);
      const regularTax = progressiveTax(taxableIncome, brackets).tax;

      return {
        amount: clampTax(regularTax - householdCredit),
        taxableIncome,
        details: [
          `New York standard deduction: ${formatPlainMoney(standardDeduction)}.`,
          `Household credit modeled: ${formatPlainMoney(householdCredit)}.`,
          "High-income NY tax-benefit recapture is not modeled.",
        ],
      };
    },
  },

  newYorkCity2026: {
    label: "New York City",
    taxYear: "2026",
    calculate(income) {
      const taxableIncome = Math.max(0, income - 8000);
      const brackets = [
        { upTo: 12000, rate: 0.03078 },
        { upTo: 25000, rate: 0.03762 },
        { upTo: 50000, rate: 0.03819 },
        { upTo: null, rate: 0.03876 },
      ];
      const householdCredit = creditFromTable(income, [
        { upTo: 10000, amount: 15 },
        { upTo: 12500, amount: 10 },
        { upTo: null, amount: 0 },
      ]);
      const regularTax = progressiveTax(taxableIncome, brackets).tax;

      return {
        amount: clampTax(regularTax - householdCredit),
        taxableIncome,
        details: [
          "Effective rates include the 14% NYC additional tax.",
          `NYC household credit modeled: ${formatPlainMoney(householdCredit)}.`,
        ],
      };
    },
  },

  newJersey2025: {
    label: "New Jersey",
    taxYear: "2025 latest available / 2026 estimated structure",
    calculate(income) {
      if (income <= 10000) {
        return {
          amount: 0,
          taxableIncome: 0,
          details: ["NJ filing threshold for single filers is modeled as $10,000."],
        };
      }

      const taxableIncome = Math.max(0, income - 1000);
      const brackets = [
        { upTo: 20000, rate: 0.014 },
        { upTo: 35000, rate: 0.0175 },
        { upTo: 40000, rate: 0.035 },
        { upTo: 75000, rate: 0.05525 },
        { upTo: 500000, rate: 0.0637 },
        { upTo: 1000000, rate: 0.0897 },
        { upTo: null, rate: 0.1075 },
      ];
      const regularTax = progressiveTax(taxableIncome, brackets).tax;

      return {
        amount: regularTax,
        taxableIncome,
        details: [
          "Uses New Jersey state wages as the income base.",
          "Regular personal exemption modeled: $1,000.",
          "NJ earned income tax credit is not modeled.",
        ],
      };
    },
  },

  canadaFederal2026: {
    label: "Canada federal",
    taxYear: "2026",
    calculate: (income) => calculateCanadaFederal2026(income),
  },

  canadaFederalQuebec2026: {
    label: "Canada federal",
    taxYear: "2026",
    calculate: (income) => calculateCanadaFederal2026(income, { quebecAbatement: true }),
  },

  ontario2026: {
    label: "Ontario",
    taxYear: "2026",
    calculate(income) {
      const brackets = [
        { upTo: 53891, rate: 0.0505 },
        { upTo: 107785, rate: 0.0915 },
        { upTo: 150000, rate: 0.1116 },
        { upTo: 220000, rate: 0.1216 },
        { upTo: null, rate: 0.1316 },
      ];
      const basicTax = progressiveTax(income, brackets).tax;
      const basicPersonalCredit = 12989 * 0.0505;
      const baseAfterCredits = Math.max(0, basicTax - basicPersonalCredit);
      const surtax = calculateOntarioSurtax(baseAfterCredits);
      const taxBeforeReduction = baseAfterCredits + surtax;
      const reduction = Math.max(0, Math.min(taxBeforeReduction, 600 - taxBeforeReduction));
      const healthPremium = calculateOntarioHealthPremium(income);
      const amount = clampTax(taxBeforeReduction - reduction + healthPremium);

      return {
        amount,
        taxableIncome: income,
        details: [
          `Ontario basic personal credit modeled: ${formatPlainMoney(basicPersonalCredit)}.`,
          `Ontario surtax: ${formatPlainMoney(surtax)}.`,
          `Ontario tax reduction: ${formatPlainMoney(reduction)}.`,
          `Ontario Health Premium: ${formatPlainMoney(healthPremium)}.`,
        ],
      };
    },
  },

  quebec2026: {
    label: "Quebec",
    taxYear: "2026",
    calculate(income) {
      const workerDeduction = Math.min(0.06 * income, 1450);
      const taxableIncome = Math.max(0, income - workerDeduction);
      const brackets = [
        { upTo: 54345, rate: 0.14 },
        { upTo: 108680, rate: 0.19 },
        { upTo: 132245, rate: 0.24 },
        { upTo: null, rate: 0.2575 },
      ];
      const basicTax = progressiveTax(taxableIncome, brackets).tax;
      const basicPersonalCredit = 18952 * 0.14;
      const amount = clampTax(basicTax - basicPersonalCredit);

      return {
        amount,
        taxableIncome,
        details: [
          `Deduction for workers modeled: ${formatPlainMoney(workerDeduction)}.`,
          `Quebec basic personal credit modeled: ${formatPlainMoney(basicPersonalCredit)}.`,
          "QPP, EI, and QPIP contribution credits/deductions are not modeled.",
        ],
      };
    },
  },

  hongKong2026: {
    label: "Hong Kong SAR salaries tax",
    taxYear: "2026/27",
    calculate(income) {
      const basicAllowance = 145000;
      const netChargeableIncome = Math.max(0, income - basicAllowance);
      const progressive = progressiveTax(netChargeableIncome, [
        { upTo: 50000, rate: 0.02 },
        { upTo: 100000, rate: 0.06 },
        { upTo: 150000, rate: 0.10 },
        { upTo: 200000, rate: 0.14 },
        { upTo: null, rate: 0.17 },
      ]).tax;
      const standardRateTax = progressiveTax(income, [
        { upTo: 5000000, rate: 0.15 },
        { upTo: null, rate: 0.16 },
      ]).tax;

      return {
        amount: Math.min(progressive, standardRateTax),
        taxableIncome: netChargeableIncome,
        details: [
          `Basic allowance: ${formatPlainMoney(basicAllowance)}.`,
          `Progressive tax: ${formatPlainMoney(progressive)}.`,
          `Standard-rate cap on net income: ${formatPlainMoney(standardRateTax)}.`,
        ],
      };
    },
  },

  noCaliforniaMunicipal: zeroBucket("Municipal", "No California municipal wage income tax is modeled."),
  noJerseyCityMunicipal: zeroBucket("Jersey City", "No Jersey City resident wage income tax is modeled."),
  noTorontoMunicipal: zeroBucket("Toronto", "No Toronto municipal personal income tax is modeled."),
  noMontrealMunicipal: zeroBucket("Montreal", "No Montreal municipal personal income tax is modeled."),
  noHongKongRegional: zeroBucket("Regional", "Hong Kong has no separate regional personal income tax."),
  noHongKongMunicipal: zeroBucket("Municipal", "Hong Kong has no separate municipal personal income tax."),
};

function calculateOntarioSurtax(baseAfterCredits) {
  if (baseAfterCredits <= 5818) return 0;
  if (baseAfterCredits <= 7446) return roundCents(0.20 * (baseAfterCredits - 5818));
  return roundCents(0.20 * (baseAfterCredits - 5818) + 0.36 * (baseAfterCredits - 7446));
}

function calculateOntarioHealthPremium(income) {
  if (income <= 20000) return 0;
  if (income <= 36000) return Math.min(300, 0.06 * (income - 20000));
  if (income <= 48000) return Math.min(450, 300 + 0.06 * (income - 36000));
  if (income <= 72000) return Math.min(600, 450 + 0.25 * (income - 48000));
  if (income <= 200000) return Math.min(750, 600 + 0.25 * (income - 72000));
  return roundCents(Math.min(900, 750 + 0.25 * (income - 200000)));
}

export const taxLocations = [
  {
    id: "california",
    name: "California",
    currency: "USD",
    components: {
      federal: taxComponents.usFederal2026,
      regional: taxComponents.california2025,
      municipal: taxComponents.noCaliforniaMunicipal,
    },
    notes: [
      "Federal rules use 2026 IRS values. California uses the latest FTB table found during implementation: 2025.",
      "Assumes single California resident, ordinary wage income, no itemized deductions, no dependents.",
    ],
    sources: [
      ["IRS 2026 inflation adjustments", "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf"],
      ["California FTB tax tables and rates", "https://www.ftb.ca.gov/file/personal/tax-calculator-tables-rates.asp"],
      ["California 2025 Form 540 tax rate schedules", "https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf"],
    ],
  },
  {
    id: "new-york-city",
    name: "New York City",
    currency: "USD",
    components: {
      federal: taxComponents.usFederal2026,
      regional: taxComponents.newYorkState2026,
      municipal: taxComponents.newYorkCity2026,
    },
    notes: [
      "Assumes full-year New York City resident, single filer, ordinary wage income, no itemized deductions, no dependents.",
      "The New York State estimate does not model high-income tax-benefit recapture.",
    ],
    sources: [
      ["IRS 2026 inflation adjustments", "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf"],
      ["New York Tax Law section 601", "https://www.nysenate.gov/legislation/laws/TAX/601"],
      ["New York resident income tax instructions", "https://www.tax.ny.gov/forms/current-forms/it/it201i.htm"],
      ["New York Tax Law section 1304-B", "https://www.nysenate.gov/legislation/laws/TAX/1304-B"],
    ],
  },
  {
    id: "jersey-city",
    name: "Jersey City",
    currency: "USD",
    components: {
      federal: taxComponents.usFederal2026,
      regional: taxComponents.newJersey2025,
      municipal: taxComponents.noJerseyCityMunicipal,
    },
    notes: [
      "Federal rules use 2026 IRS values. New Jersey uses the latest official NJ resident instructions found during implementation plus the current 2026 estimated-tax structure.",
      "Assumes single Jersey City resident, ordinary wage income, no itemized deductions, no dependents.",
    ],
    sources: [
      ["IRS 2026 inflation adjustments", "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf"],
      ["New Jersey resident instructions", "https://www.nj.gov/treasury/taxation/pdf/current/1040i.pdf"],
      ["New Jersey 2026 estimated tax form", "https://www.nj.gov/treasury/taxation/pdf/current/1040es.pdf"],
    ],
  },
  {
    id: "toronto",
    name: "Toronto",
    currency: "CAD",
    components: {
      federal: taxComponents.canadaFederal2026,
      regional: taxComponents.ontario2026,
      municipal: taxComponents.noTorontoMunicipal,
    },
    notes: [
      "Assumes Ontario resident, single filer, ordinary employment income, no dependents.",
      "CPP and EI payroll contribution credits are not modeled.",
    ],
    sources: [
      ["CRA 2026 tax rates", "https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html"],
      ["CRA 2026 indexed amounts", "https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html"],
      ["CRA T4127 Ontario formulas", "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html"],
    ],
  },
  {
    id: "montreal",
    name: "Montreal",
    currency: "CAD",
    components: {
      federal: taxComponents.canadaFederalQuebec2026,
      regional: taxComponents.quebec2026,
      municipal: taxComponents.noMontrealMunicipal,
    },
    notes: [
      "Assumes Quebec resident, single filer, ordinary employment income, no dependents.",
      "QPP, EI, and QPIP payroll contribution credits/deductions are not modeled.",
    ],
    sources: [
      ["CRA 2026 tax rates", "https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html"],
      ["CRA Quebec abatement", "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-44000-refundable-quebec-abatement.html"],
      ["Revenu Quebec income tax rates", "https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/income-tax-rates/"],
      ["Revenu Quebec 2026 source deduction formulas", "https://www.revenuquebec.ca/documents/en/formulaires/tp/TP-1015.G-V%282026-01%29.pdf"],
    ],
  },
  {
    id: "hong-kong",
    name: "Hong Kong",
    currency: "HKD",
    components: {
      federal: taxComponents.hongKong2026,
      regional: taxComponents.noHongKongRegional,
      municipal: taxComponents.noHongKongMunicipal,
    },
    notes: [
      "Assumes Hong Kong employment income, single taxpayer, no dependents, no deductions.",
      "Salaries tax is the lower of progressive tax on net chargeable income and standard-rate tax on net income.",
    ],
    sources: [
      ["IRD salaries tax rates and allowances", "https://www.ird.gov.hk/eng/pdf/pam61e.pdf"],
      ["GovHK salaries tax rates", "https://www.gov.hk/en/residents/taxes/taxfiling/taxrates/salariesrates.htm"],
      ["GovHK salaries tax computation", "https://www.gov.hk/en/residents/taxes/etax/services/tax_computation.htm"],
    ],
  },
];

export function calculateTaxes(locationId, income, options = {}) {
  const location = taxLocations.find((item) => item.id === locationId) || taxLocations[0];
  const inputCurrency = options.inputCurrency || "USD";
  const usdToCurrency = {
    ...defaultUsdToCurrency,
    ...(options.usdToCurrency || {}),
  };
  const normalizedIncome = Math.max(0, Number.isFinite(income) ? income : 0);
  const localIncome = convertCurrency(normalizedIncome, inputCurrency, location.currency, usdToCurrency);
  const buckets = ["federal", "regional", "municipal"].map((bucket) => {
    const component = location.components[bucket];
    const result = component.calculate(localIncome);
    const displayAmount = convertCurrency(result.amount, location.currency, inputCurrency, usdToCurrency);
    const displayTaxableIncome = convertCurrency(result.taxableIncome, location.currency, inputCurrency, usdToCurrency);
    return {
      bucket,
      label: component.label,
      taxYear: component.taxYear,
      amount: clampTax(result.amount),
      displayAmount: clampTax(displayAmount),
      taxableIncome: result.taxableIncome,
      displayTaxableIncome: displayTaxableIncome,
      details: result.details || [],
    };
  });
  const total = clampTax(buckets.reduce((sum, bucket) => sum + bucket.amount, 0));
  const displayTotal = clampTax(convertCurrency(total, location.currency, inputCurrency, usdToCurrency));

  return {
    location,
    inputCurrency,
    income: normalizedIncome,
    localIncome: clampTax(localIncome),
    buckets,
    total,
    displayTotal,
    afterTaxIncome: clampTax(localIncome - total),
    displayAfterTaxIncome: clampTax(normalizedIncome - displayTotal),
    effectiveRate: normalizedIncome > 0 ? displayTotal / normalizedIncome : 0,
    usdToCurrency,
  };
}

export function formatMoney(amount, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(rate) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rate);
}

function formatPlainMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(amount);
}
