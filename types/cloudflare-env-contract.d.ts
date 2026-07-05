type CloudflareEnvMissingGeneratedBindingKeys = Exclude<keyof CloudflareBindings, keyof CloudflareEnv>;
type CloudflareEnvExtraGeneratedBindingKeys = Exclude<keyof CloudflareEnv, keyof CloudflareBindings>;
type CloudflareEnvIncompatibleGeneratedBindingKeys = {
  [Binding in keyof CloudflareBindings & keyof CloudflareEnv]: CloudflareBindings[Binding] extends CloudflareEnv[Binding]
    ? never
    : Binding;
}[keyof CloudflareBindings & keyof CloudflareEnv];
type AssertNoCloudflareBindingKeyDrift<T extends never> = T;

type _CloudflareEnvHasEveryGeneratedBinding = AssertNoCloudflareBindingKeyDrift<CloudflareEnvMissingGeneratedBindingKeys>;
type _CloudflareEnvHasNoUnknownBindings = AssertNoCloudflareBindingKeyDrift<CloudflareEnvExtraGeneratedBindingKeys>;
type _CloudflareEnvAcceptsGeneratedBindingTypes = AssertNoCloudflareBindingKeyDrift<CloudflareEnvIncompatibleGeneratedBindingKeys>;
