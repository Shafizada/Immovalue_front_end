const form = document.querySelector("#prediction-form");
const predictionEl = document.querySelector("#prediction");
const pricePerM2El = document.querySelector("#price-per-m2");
const statusEl = document.querySelector("#status");

const checkboxFields = new Set([
  "terrace_yes_no",
  "garden_yes_no",
  "garage_yes_no",
  "parking_yes_no",
  "lift_yes_no",
  "double_glazing_yes_no",
  "energy_renovation_required_yes_no",
  "electricity_conform_yes_no",
  "flood_area_yes_no",
  "newbuild_yes_no",
]);

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function setDatalist(id, values) {
  const list = document.querySelector(id);
  list.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    list.appendChild(option);
  });
}

function setSelect(id, values) {
  const select = document.querySelector(id);
  if (!values || values.length === 0) return;
  select.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function applyDefaults(defaults) {
  Object.entries(defaults).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field) return;

    if (checkboxFields.has(name)) {
      field.checked = Number(value) === 1;
    } else {
      field.value = value;
    }
  });
}

function collectPayload() {
  const payload = {};
  const data = new FormData(form);

  for (const [key, value] of data.entries()) {
    payload[key] = value;
  }

  checkboxFields.forEach((key) => {
    payload[key] = form.elements[key].checked ? 1 : 0;
  });

  return payload;
}

async function predict() {
  statusEl.textContent = "Updating";

  try {
    const response = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPayload()),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Prediction failed");

    predictionEl.textContent = currencyFormatter.format(result.predicted_price);
    pricePerM2El.textContent = `${currencyFormatter.format(result.estimated_price_per_m2)} per m2 basis`;
    statusEl.textContent = "Ready";
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

function debounce(fn, delay) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

async function init() {
  let options = {
    defaults: {},
    cities: [],
    postcodes: [],
    property_types: [],
    property_subtypes: [],
    epc_labels: [],
  };

  try {
    const response = await fetch("/api/options");
    if (response.ok) options = await response.json();
  } catch (error) {
    statusEl.textContent = "Static form ready";
  }

  setDatalist("#city-options", options.cities);
  setDatalist("#postcode-options", options.postcodes);
  setDatalist("#property-type-options", options.property_types);
  setDatalist("#property-subtype-options", options.property_subtypes);
  setSelect("#epc_label", options.epc_labels);
  applyDefaults(options.defaults || {});

  const debouncedPredict = debounce(predict, 250);
  form.addEventListener("input", debouncedPredict);
  form.addEventListener("change", debouncedPredict);
  predict();
}

init();



