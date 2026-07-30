<script setup lang="ts">
defineProps<{
  id: string;
  kicker: string;
  label: string;
  help: string;
  placeholder: string;
  rows?: number;
}>();

const value = defineModel<string>({ required: true });
</script>

<template>
  <div class="field-group">
    <div class="field-heading">
      <div>
        <span class="field-kicker">{{ kicker }}</span>
        <label :for="id">{{ label }}</label>
      </div>
      <span :id="`${id}-count`" class="character-count"
        >{{ value.length.toLocaleString() }} chars</span
      >
    </div>
    <p :id="`${id}-help`">{{ help }}</p>
    <textarea
      :id="id"
      v-model="value"
      :aria-describedby="`${id}-help ${id}-count`"
      :placeholder="placeholder"
      required
      :rows="rows ?? 10"
    />
  </div>
</template>
