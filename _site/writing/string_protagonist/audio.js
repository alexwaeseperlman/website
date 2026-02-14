async function getWebAudioMediaStream() {
  if (!window.navigator.mediaDevices) {
    throw new Error(
      "This browser does not support web audio or it is not enabled."
    );
  }

  try {
    const result = await window.navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    return result;
  } catch (e) {
    switch (e.name) {
      case "NotAllowedError":
        throw new Error(
          "A recording device was found but has been disallowed for this application. Enable the device in the browser settings."
        );

      case "NotFoundError":
        throw new Error(
          "No recording device was found. Please attach a microphone and click Retry."
        );

      default:
        throw e;
    }
  }
}

export const numAudioSamplesPerAnalysis = 1 << 12;
export const sampleRate = 44100;

export async function setupAudio(context, audio, keysCallback) {
  // Get the browser audio. Awaits user "allowing" it for the current tab.
  //const mediaStream = await getWebAudioMediaStream();

  /*const context = new window.AudioContext({
    latencyHint: "interactive",
    sampleRate,
  });*/
  //const audioSource = context.createMediaStreamSource(mediaStream);
  const audioSource = audio;//context.createMediaStreamSource(audio);
  let node;

  try {
    // Make sure context is running
    if (context.state !== "running") {
      console.log(`AudioContext state is ${context.state}, attempting to resume...`);
      await context.resume();
      console.log(`AudioContext state after resume attempt: ${context.state}`);
    }

    // Debug information about the audio context
    console.log("AudioContext details:", {
      sampleRate: context.sampleRate,
      baseLatency: context.baseLatency,
      state: context.state,
      hasAudioWorklet: !!context.audioWorklet
    });

    // Check if AudioWorklet API is available
    if (!context.audioWorklet) {
      // Print more debugging information
      console.error("AudioWorklet API not detected. Context info:", context);
      console.error("AudioWorklet support should be available in:", navigator.userAgent);
      
      throw new Error("AudioWorklet API is not available. This could be due to browser settings or security restrictions.");
    }

    const response = await window.fetch("/writing/string_protagonist/audio/pkg/audio_bg.wasm");
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM file: ${response.status} ${response.statusText}`);
    }
    const wasmBytes = await response.arrayBuffer();

    // Use the correct path to PitchProcessor.js
    const processorUrl = "/writing/string_protagonist/PitchProcessor.js";
    console.log(`Attempting to load AudioWorklet from: ${processorUrl}`);
    
    try {
      await context.audioWorklet.addModule(processorUrl);
      console.log("AudioWorklet module loaded successfully!");
    } catch (e) {
      console.error("Error loading PitchProcessor worklet:", e);
      throw new Error(
        `Failed to load audio analyzer worklet at url: ${processorUrl}. Further info: ${e.message}`
      );
    }

    const modelResponse = await fetch("/writing/string_protagonist/freq_predictor.onnx");
    if (!modelResponse.ok) {
      throw new Error(`Failed to fetch model file: ${modelResponse.status} ${modelResponse.statusText}`);
    }
    const modelBytes = new Uint8Array(await modelResponse.arrayBuffer());
    
    node = new PitchNode(context, "PitchProcessor");

    node.init(wasmBytes, modelBytes, keysCallback, numAudioSamplesPerAnalysis);

    audioSource.connect(node);

    node.connect(context.destination);
  } catch (err) {
    console.error("Audio setup error:", err);
    throw new Error(
      `Failed to load audio analyzer WASM module. Further info: ${err.message}`
    );
  }

  return {
    teardownAudio: () => {
      if (node) node.disconnect();
      if (audioSource) audioSource.disconnect();
      // Don't close the context here, as it might be reused
    },
    noteEvent: (notes) => {
      console.log("notes exit", notes);
    },
  };
}

export default class PitchNode extends AudioWorkletNode {
  keysCallback;
  numAudioSamplesPerAnalysis;

  init(
    wasmBytes,
    modelBytes,
    keysCallback,
    numAudioSamplesPerAnalysis
  ) {
    this.keysCallback = keysCallback;
    this.numAudioSamplesPerAnalysis = numAudioSamplesPerAnalysis;

    // Listen to messages sent from the audio processor.
    this.port.onmessage = (event) => this.onmessage(event.data);

    this.port.postMessage({
      type: "send-wasm-module",
      wasmBytes,
      modelBytes,
    });
  }

  onmessage(event) {
    if (event.type === "wasm-module-loaded") {
      this.port.postMessage({
        type: "init-detector",
        sampleRate: this.context.sampleRate,
        numAudioSamplesPerAnalysis: this.numAudioSamplesPerAnalysis,
      });
    } else if (event.type === "keys") {
      if (this.keysCallback) this.keysCallback(event.probabilities);
    }
  }
}