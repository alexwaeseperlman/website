importScripts(
  "https://cdn.jsdelivr.net/npm/decimal.js-light@2.5.1/decimal.min.js"
);
Decimal.set({
  precision: 100,
});

const pi = new Decimal(
  "3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067982148086513282306647093844609550582231725359408128481117450284102701938521105559644622948954930381964428810975665933446128475648233786783165271201909145648566923460348610454326648213393607260249141273"
);
const lnpi2 = pi.dividedBy(2).ln();
const ln4 = new Decimal(4).ln();
let interval = null;
function stirling(n) {
  const base = n.times(n.ln()).minus(n).plus(lnpi2);
  let ext = new Decimal(0);
  if (n.gt(1e10)) ext = n.times(8).ln().times(3);
  else if (n.gt(1e5))
    ext = n.ln().times(2).plus(n.times(2).plus(1).ln()).plus(ln4);
  else
    ext = n
      .times(n)
      .times(n)
      .times(8)
      .plus(n.times(n).times(4))
      .plus(n)
      .plus(1 / 30)
      .ln();
  return base.plus(ext.dividedBy(6));
}

function logBirthday(numPeople, numDays) {
  if (numDays.lte(numPeople)) return new Decimal(-1e6);
  return stirling(numDays)
    .minus(stirling(numDays.minus(numPeople)))
    .minus(numPeople.times(numDays.ln()));
}

const bsearchIters = 75;
const innerBsearchIters = 25;
function updateNumPeople(probStr, numDaysStr) {
  if (interval) clearInterval(interval);
  const target = new Decimal(1).minus(new Decimal(probStr)).ln();
  const numDays = new Decimal(numDaysStr);
  // binary search
  let lb = new Decimal(0),
    ub = numDays.plus(0);
  let cnt = 0;
  interval = setInterval(() => {
    cnt++;
    if (cnt >= bsearchIters) {
      clearInterval(interval);
    }
    // fixed number of iterations
    let mid;
    for (let i = 0; i < innerBsearchIters; i++) {
      mid = lb.plus(ub).dividedBy(2);
      const val = logBirthday(mid, numDays);
      if (val.gt(target)) lb = mid;
      else ub = mid;
    }
    const str = mid.toFixed(0);
    if (str.length > 10)
      postMessage({
        type: "num-people",
        value: mid.toExponential(5),
      });
    else {
      postMessage({
        type: "num-people",
        value: str,
      });
    }
  }, 1);
}

function updateNumDays(numPeopleStr, probStr) {
  if (interval) clearInterval(interval);
  const target = new Decimal(1).minus(new Decimal(probStr)).ln();
  const numPeople = new Decimal(numPeopleStr);
  // binary search
  let lb = numPeople,
    ub = new Decimal(2);
  let cnt = 0;
  interval = setInterval(() => {
    cnt++;
    if (cnt >= bsearchIters) {
      clearInterval(interval);
    }
    let mid;
    for (let i = 0; i < innerBsearchIters; i++) {
      mid = lb.plus(ub).dividedBy(2);

      if (logBirthday(numPeople, ub).lt(target)) {
        lb = ub.plus(0);
        ub = ub.times(2);
      } else {
        const val = logBirthday(numPeople, mid);
        if (val.gt(target)) ub = mid;
        else lb = mid;
      }
    }
    const str = mid.toFixed(0);
    if (str.length > 10)
      postMessage({
        type: "num-days",
        value: mid.toExponential(5),
      });
    else {
      postMessage({
        type: "num-days",
        value: str,
      });
    }
  }, 1);
}

function updateProbCollision(numPeopleStr, numDaysStr) {
  const numPeople = new Decimal(numPeopleStr);
  const numDays = new Decimal(numDaysStr);
  postMessage({
    type: "prob-collision",
    value: new Decimal(1)
      .minus(logBirthday(numPeople, numDays).naturalExponential())
      .toFixed(9),
  });
}

onmessage = function (e) {
  if (e.data.type === "num-people") {
    updateNumPeople(e.data.probCollision, e.data.numDays);
  }
  if (e.data.type === "prob-collision") {
    updateProbCollision(e.data.numPeople, e.data.numDays);
  }
  if (e.data.type == "num-days") {
    updateNumDays(e.data.numPeople, e.data.probCollision);
  }
};
