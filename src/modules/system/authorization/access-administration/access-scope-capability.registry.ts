import {
  AccessScopePreset,
  AccessScopePresetType,
  PRESET_DEFINITIONS,
  PresetDefinition,
} from './access-scope-preset.constants.js';

export const PERMISSION_SCOPE_CAPABILITIES: Record<string, AccessScopePresetType[]> = {
  'production.department.view': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
  ],
  'production.department.create': [
    AccessScopePreset.ALL,
  ],
  'production.department.update': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
  ],
  'production.department.delete': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
  ],
  'production.yard.view': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.CURRENT_PRODUCTION_YARDS,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
    AccessScopePreset.SPECIFIC_PRODUCTION_YARDS,
  ],
  'production.yard.create': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
  ],
  'production.yard.update': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.CURRENT_PRODUCTION_YARDS,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
    AccessScopePreset.SPECIFIC_PRODUCTION_YARDS,
  ],
  'production.yard.delete': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.CURRENT_PRODUCTION_YARDS,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
    AccessScopePreset.SPECIFIC_PRODUCTION_YARDS,
  ],
  'production.yard-templates.view': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.CURRENT_PRODUCTION_YARDS,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
    AccessScopePreset.SPECIFIC_PRODUCTION_YARDS,
  ],
  'production.yard-templates.add': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.CURRENT_PRODUCTION_YARDS,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
    AccessScopePreset.SPECIFIC_PRODUCTION_YARDS,
  ],
  'production.yard-templates.update': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.CURRENT_PRODUCTION_YARDS,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
    AccessScopePreset.SPECIFIC_PRODUCTION_YARDS,
  ],
  'production.yard-templates.remove': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.CURRENT_PRODUCTION_YARDS,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
    AccessScopePreset.SPECIFIC_PRODUCTION_YARDS,
  ],
  'production.assignment.view': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
  ],
  'production.assignment.manage': [
    AccessScopePreset.ALL,
    AccessScopePreset.CURRENT_PRODUCTION_DEPARTMENT,
    AccessScopePreset.SPECIFIC_PRODUCTION_DEPARTMENTS,
  ],
  'production.template.view': [
    AccessScopePreset.ALL,
  ],
  'production.template.create': [
    AccessScopePreset.ALL,
  ],
  'production.template.update': [
    AccessScopePreset.ALL,
  ],
  'production.template.delete': [
    AccessScopePreset.ALL,
  ],
  'production.order.view': [
    AccessScopePreset.ALL,
  ],
  'production.order.create': [
    AccessScopePreset.ALL,
  ],
  'production.order.update': [
    AccessScopePreset.ALL,
  ],
  'production.order.delete': [
    AccessScopePreset.ALL,
  ],
  'production.order.approve': [
    AccessScopePreset.ALL,
  ],
  'production.order.update_priority': [
    AccessScopePreset.ALL,
  ],
};

export class AccessScopeCapabilityRegistry {
  /**
   * Returns list of supported preset types for a given permission.
   * Rules:
   * 1. If explicitly defined in PERMISSION_SCOPE_CAPABILITIES -> return registered capabilities.
   * 2. If permission starts with 'production.' but not registered -> return [] (Fail Closed).
   * 3. If non-production permission and not registered -> return [AccessScopePreset.ALL].
   */
  static getAllowedPresetsForPermission(permissionName: string): AccessScopePresetType[] {
    const capabilities = PERMISSION_SCOPE_CAPABILITIES[permissionName];
    if (capabilities && capabilities.length > 0) {
      return [...capabilities];
    }
    if (permissionName.startsWith('production.')) {
      return [];
    }
    return [AccessScopePreset.ALL];
  }

  /**
   * Returns rich capability definitions for a given permission.
   */
  static getCapabilitiesForPermission(permissionName: string): PresetDefinition[] {
    const allowed = this.getAllowedPresetsForPermission(permissionName);
    return allowed.map((presetKey) => PRESET_DEFINITIONS[presetKey]);
  }

  /**
   * Validates whether a specific preset is allowed for the given permission.
   */
  static isPresetAllowed(permissionName: string, preset: AccessScopePresetType): boolean {
    const allowed = this.getAllowedPresetsForPermission(permissionName);
    return allowed.includes(preset);
  }
}
