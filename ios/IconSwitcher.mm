#import "IconSwitcher.h"

#import "ISIconSwitcher.h"

#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

using namespace facebook::react;

@implementation IconSwitcher {
  ISIconSwitcher *_switcher;
  BOOL _cachedIsSupported;
}

- (instancetype)init
{
  if (self = [super init]) {
    _switcher = [ISIconSwitcher defaultSwitcher];
    _cachedIsSupported = UIApplication.sharedApplication.supportsAlternateIcons;
  }
  return self;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeIconSwitcherSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"IconSwitcher";
}

- (ModuleConstants<JS::NativeIconSwitcher::Constants>)constantsToExport
{
  return [self getConstants];
}

- (ModuleConstants<JS::NativeIconSwitcher::Constants>)getConstants
{
  NSArray<NSString *> *names = _switcher.iconNames;
  std::vector<NSString *> iconNames;
  iconNames.reserve(names.count);
  for (NSString *name in names) {
    iconNames.push_back(name);
  }

  return typedConstants<JS::NativeIconSwitcher::Constants>({
      .isSupported = _cachedIsSupported,
      .iconNames = iconNames,
  });
}

- (void)getCurrent:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([_switcher currentIconName]);
}

- (void)set:(NSString *)name
    resolve:(RCTPromiseResolveBlock)resolve
     reject:(RCTPromiseRejectBlock)reject
{
  [_switcher setIconName:name
              completion:^(NSError *_Nullable error) {
                if (error != nil) {
                  reject([self _rejectionCodeForError:error], error.localizedDescription, error);
                  return;
                }
                resolve(@{@"status" : @"applied"});
              }];
}

- (void)applyPending:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(@{@"status" : @"none"});
}

- (NSString *)_rejectionCodeForError:(NSError *)error
{
  if (![error.domain isEqualToString:ISIconSwitcherErrorDomain]) {
    return @"ERR_OS_REJECTED";
  }

  switch ((ISIconSwitcherErrorCode)error.code) {
    case ISIconSwitcherErrorCodeUnsupported:
      return @"ERR_UNSUPPORTED";
    case ISIconSwitcherErrorCodeUnknownIcon:
      return @"ERR_UNKNOWN_ICON";
    case ISIconSwitcherErrorCodeOSRejected:
    default:
      return @"ERR_OS_REJECTED";
  }
}

@end
