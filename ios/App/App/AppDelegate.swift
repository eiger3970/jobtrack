import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // 2026-11-10 owner: long-press the app icon for quick actions (add, email, sync, Job-Room entries). The tap is passed to
    // the web app, retrying until the page has finished loading (a cold start has no page yet).
    func deliverShortcut(_ action: String, attempt: Int = 0) {
        guard attempt < 40 else { return }
        let js = "(function(){var r=document.getElementById('root');if(document.readyState==='complete'&&r&&r.children.length>0){window.__jtQuick='\(action)';window.dispatchEvent(new Event('jt-quick'));return 1;}return 0;})()"
        let vc = window?.rootViewController as? CAPBridgeViewController
        vc?.webView?.evaluateJavaScript(js) { result, _ in
            if let n = result as? NSNumber, n.intValue == 1 { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.deliverShortcut(action, attempt: attempt + 1) }
        }
        if vc == nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.deliverShortcut(action, attempt: attempt + 1) }
        }
    }

    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        deliverShortcut(shortcutItem.type)
        completionHandler(true)
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        if let item = launchOptions?[UIApplication.LaunchOptionsKey.shortcutItem] as? UIApplicationShortcutItem {
            deliverShortcut(item.type)
            return false
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
