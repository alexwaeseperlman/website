let image = [];
addEventListener('message', (e) => {
    image = e.data;
    reset();
});

const decay = 0.9999;
const maxCnt = 2;
let temperature, score, lines, curImage, lineNodes = [], curLine = 0, lineOrder = [];
const spacing = 1;
const lineCnt = 500;

function colorContribution(cnt) {
  //return -(1 - 1.08**(-cnt));
  return -cnt/maxCnt;
  //if (cnt == 1) return -1;
  //else return 0;
}

function shuffleLineOrder() {
    for (let i = lineCnt*lineCnt-1; i >= 0; i--) {
        let j = Math.floor(Math.random() * i);
        let temp = lineOrder[i];
        lineOrder[i] = lineOrder[j];
        lineOrder[j] = temp;
    }
}

function reset() {
    temperature = 1;
    curImage = [];
    lines = [];
    curLine = 0
    lineOrder = [];
    //lineCnt = Math.floor(image.length/spacing) * 4;
    lineNodes = []
    for (let i = 0; i < lineCnt; i++) {
        lineNodes.push([Math.random() * image.length, Math.random() * image[0].length]);
        lines.push([]);
        for (let j = 0; j < lineCnt; j++) {
            lineOrder.push(i*lineCnt+j);
            lines[i].push(0);
        }
    }
    shuffleLineOrder();
    score = 0;
    for (let i = 0; i < image.length; i++) {
        curImage.push([]);
        for (let j = 0; j < image[0].length; j++) {
            curImage[i].push(1);
            score += loss(curImage[i][j], image[i][j])
        }
    }
}

function getPointPosition(a) {
    return [Math.floor(lineNodes[a][0]), Math.floor(lineNodes[a][1])];
}

function loss(pred, real) {
    pred = Math.min(1, Math.max(-1.5, pred));
    return Math.abs(pred - real)*0.7;
}

function stepLine(a, b, direction) {
    let A = getPointPosition(a);
    let B = getPointPosition(b);
    if (A[0] > B[0]) {
        let temp = A;
        A = B;
        B = temp;
    }
    for (let i = A[0]; i <= B[0]; i++) {
        if (i < 0 || i >= curImage.length) {
            continue;
        }
        let y1 = A[1] + (1 + B[1] - A[1]) * (i - A[0]) / (B[0] - A[0]+1);
        let y2 = A[1] + (1 + B[1] - A[1]) * (i - A[0] + 1) / (B[0] - A[0]+1);
        if (y1 > y2) {
            let temp = y1;
            y1 = y2;
            y2 = temp;
        }

        for (let j = Math.floor(y1); j < Math.ceil(y2); j++) {
            if (j < 0 || j >= curImage[0].length) {
                continue;
            }
            score -= loss(curImage[i][j], image[i][j]);
            curImage[i][j] -= colorContribution(lines[a][b]);
            curImage[i][j] += colorContribution(lines[a][b] + direction);
            score += loss(curImage[i][j], image[i][j]);
        }
    }
    lines[a][b] += direction;
}

function step() {
    //let row = Math.floor(Math.random() * lines.length);
    //let col = Math.floor(Math.random() * lines[0].length);
    let curLineVal = lineOrder[curLine];
    let row = Math.floor(curLineVal/lineCnt);
    let col = curLineVal%lineCnt;
    let direction = 1;
    if (lines[row][col] > 0 && lines[row][col] < maxCnt) {
        if (Math.random() < 0.5) {
            direction = -1;
        }
    }
    else if (lines[row][col] >= maxCnt) {
        direction = -1;
    }
    let oldScore = score;
    stepLine(row, col, direction);
    let delta = -(score - oldScore);
    if (delta > 0 || Math.random() < Math.exp(delta/temperature)) {
        // accept
    } else {
        stepLine(row, col, -direction);
    }
    curLine++;
    if (curLine >= lineCnt*lineCnt) {
        shuffleLineOrder();
        curLine = 0;
    }
}

setInterval(() => {
    if (image.length === 0) {
        return;
    }
    for (let i = 0; i < 2000; i++) {
        temperature *= decay;
        step();
    }
    postMessage(curImage);
    console.log(score, temperature)
}, 20);