<script lang="ts">
  import Menu from './ui/Menu.svelte';
  import Play from './ui/Play.svelte';
  import CityMap from './ui/CityMap.svelte';
  import Controls from './ui/Controls.svelte';
  import Options from './ui/Options.svelte';
  import RotatePrompt from './ui/RotatePrompt.svelte';
  import { loadSave } from './game/systems/save.ts';
  import { enterFullscreen } from './ui/device.ts';

  type Screen = 'menu' | 'play' | 'map' | 'controls' | 'options';
  let screen = $state<Screen>('menu');

  function play() {
    enterFullscreen();
    screen = 'play';
  }
</script>

<RotatePrompt />

{#if screen === 'menu'}
  <Menu
    onPlay={play}
    onMap={() => (screen = 'map')}
    onControls={() => (screen = 'controls')}
    onOptions={() => (screen = 'options')}
  />
{:else if screen === 'play'}
  <Play onMenu={() => (screen = 'menu')} />
{:else if screen === 'map'}
  <CityMap unlocked={loadSave().unlocked} player={null} onBack={() => (screen = 'menu')} onPlay={play} />
{:else if screen === 'controls'}
  <Controls onBack={() => (screen = 'menu')} />
{:else if screen === 'options'}
  <Options onBack={() => (screen = 'menu')} />
{/if}
