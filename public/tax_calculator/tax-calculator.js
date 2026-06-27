import {
  calculateTaxes,
  defaultUsdToCurrency,
  formatMoney,
  formatPercent,
  supportedCurrencies,
  taxLocations,
} from "./tax-rules.js";

const incomeInput = document.getElementById("income");
const currencySelect = document.getElementById("currency");
const locationSelect = document.getElementById("location");
const output = document.getElementById("tax-output");
const taxForm = document.getElementById("tax-form");
const fxSettings = document.getElementById("fx-settings");
const usdToCurrency = { ...defaultUsdToCurrency };

for (const location of taxLocations) {
  const option = document.createElement("option");
  option.value = location.id;
  option.textContent = `${location.name} (${location.currency})`;
  locationSelect.appendChild(option);
}

for (const currency of supportedCurrencies) {
  const option = document.createElement("option");
  option.value = currency.code;
  option.textContent = `${currency.code} - ${currency.label}`;
  currencySelect.appendChild(option);
}

locationSelect.value = "new-york-city";
currencySelect.value = "USD";

taxForm.addEventListener("submit", (event) => event.preventDefault());
incomeInput.addEventListener("input", render);
currencySelect.addEventListener("change", render);
locationSelect.addEventListener("change", render);

render();

function render() {
  const income = Number(incomeInput.value);
  const result = calculateTaxes(locationSelect.value, income, {
    inputCurrency: currencySelect.value,
    usdToCurrency,
  });
  const displayCurrency = result.inputCurrency;
  const localCurrency = result.location.currency;

  if (!Number.isFinite(income) || income < 0) {
    incomeInput.classList.add("error");
  } else {
    incomeInput.classList.remove("error");
  }

  renderFxSettings(result);

  output.innerHTML = `
    <div class="tax-summary">
      ${renderMetric("Yearly tax", formatMoney(result.displayTotal, displayCurrency))}
      ${renderMetric("After-tax income", formatMoney(result.displayAfterTaxIncome, displayCurrency))}
      ${renderMetric("Effective rate", formatPercent(result.effectiveRate))}
    </div>

    ${displayCurrency === localCurrency ? "" : `
      <p class="tax-note tax-muted">
        ${formatMoney(result.income, displayCurrency)} is converted to
        ${formatMoney(result.localIncome, localCurrency)} before applying
        ${result.location.name} tax rules.
      </p>
    `}

    <div>
      <div class="tax-small-label">Breakdown</div>
      <div class="tax-table-wrap">
        <table class="tax-breakdown">
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Rule set</th>
              <th>Taxable income</th>
              <th>Tax</th>
            </tr>
          </thead>
          <tbody>
            ${result.buckets.map((bucket) => renderBucket(bucket, displayCurrency, localCurrency)).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="tax-small-label">Assumptions</div>
      <ul class="tax-detail-list">
        ${result.location.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        <li>Tax rules are applied in ${result.location.currency}; displayed totals use ${displayCurrency}.</li>
      </ul>
    </div>

    <div>
      <div class="tax-small-label">Sources</div>
      <ul class="tax-source-list">
        ${result.location.sources.map(([label, href]) => renderSource(label, href)).join("")}
      </ul>
    </div>
  `;
}

function renderFxSettings(result) {
  const currenciesToEdit = supportedCurrencies
    .map((currency) => currency.code)
    .filter((currency) => currency !== "USD");

  fxSettings.innerHTML = `
    <div class="tax-small-label">Exchange rate assumptions</div>
    <p class="tax-note tax-muted">
      Used only when the selected income currency differs from the tax-rule currency.
      Defaults are static and editable.
    </p>
    <div class="fx-grid">
      ${currenciesToEdit.map((currency) => renderFxInput(currency)).join("")}
    </div>
  `;

  for (const input of fxSettings.querySelectorAll("input[data-currency]")) {
    input.addEventListener("input", () => {
      const currency = input.dataset.currency;
      const rate = Number(input.value);
      if (Number.isFinite(rate) && rate > 0) {
        input.classList.remove("error");
      } else {
        input.classList.add("error");
      }
    });
    input.addEventListener("change", () => {
      const currency = input.dataset.currency;
      const rate = Number(input.value);
      if (Number.isFinite(rate) && rate > 0) {
        input.classList.remove("error");
        usdToCurrency[currency] = rate;
        render();
      } else {
        input.classList.add("error");
      }
    });
  }
}

function renderFxInput(currency) {
  return `
    <label class="fx-rate-field">
      <span>1 USD =</span>
      <input data-currency="${escapeAttribute(currency)}" type="number" min="0.0001" step="0.0001" value="${escapeAttribute(usdToCurrency[currency])}" inputmode="decimal" />
      <span>${escapeHtml(currency)}</span>
    </label>
  `;
}

function renderMetric(label, value) {
  return `
    <div class="tax-metric">
      <span class="tax-small-label">${escapeHtml(label)}</span>
      <span class="tax-metric-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function renderBucket(bucket, displayCurrency, localCurrency) {
  const displayAmount = formatMoney(bucket.displayAmount, displayCurrency);
  const localAmount = formatMoney(bucket.amount, localCurrency);
  const displayTaxableIncome = formatMoney(bucket.displayTaxableIncome, displayCurrency);
  const localTaxableIncome = formatMoney(bucket.taxableIncome, localCurrency);

  return `
    <tr>
      <td>
        ${capitalize(bucket.bucket)}
        ${bucket.details.length > 0 ? `<ul class="tax-detail-list">${bucket.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : ""}
      </td>
      <td>${escapeHtml(bucket.label)}<br><span class="tax-muted">${escapeHtml(bucket.taxYear)}</span></td>
      <td>${displayTaxableIncome}${displayCurrency === localCurrency ? "" : `<br><span class="tax-muted">${localTaxableIncome}</span>`}</td>
      <td>${displayAmount}${displayCurrency === localCurrency ? "" : `<br><span class="tax-muted">${localAmount}</span>`}</td>
    </tr>
  `;
}

function renderSource(label, href) {
  return `<li><a href="${escapeAttribute(href)}">${escapeHtml(label)}</a></li>`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
